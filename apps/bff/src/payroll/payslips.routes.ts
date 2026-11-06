import { allWageEmployees } from '../hr/hr.routes.ts'
import { upstream } from '../hr/employee-scope.ts'
import { IdempotencyKeys } from '../idempotency.ts'
import { readObject } from '../legacy-body.ts'
import { LegacyError } from '../legacy-error.ts'
import { json } from '../router.ts'
import { callApi } from '../upstream.ts'
import type { Route, SignedInContext } from '../router.ts'
import type { Payslip, PayslipSendJob, PayrollLedger, PayrollRow } from '../upstream.types.ts'
import { toLegacySummary } from './ledgers.mapping.ts'
import { ledgerOf, parentOf, read, rowsOf } from './ledgers.routes.ts'
import {
  assertRowIdFormat,
  isWageRow,
  parsePayslipSave,
  parseRowIds,
  rowsNotOnCard,
  toLegacyNotification,
  toLegacyPayslipRow,
  toLegacySendResults,
  unsupportedEmail,
} from './payslips.mapping.ts'

const CARD = '/api/company/:companyId/payroll/cards/:cardId'

/** BFF가 만든 `Idempotency-Key`의 앞부분입니다. 새 API 쪽에서 현행 화면의 발송을 알아보게 합니다. */
const SEND_KEY_PREFIX = 'bff-payslip-send'

/** 클라이언트 키를 세션·대상에 묶은 키의 앞부분입니다. */
const CLIENT_KEY_PREFIX = 'bff-client'

/** 마감 전 카드의 명세서 발송 거절입니다. 현행 서버와 같은 문구입니다. */
function notClosed(): LegacyError {
  return new LegacyError(409, {
    detail: 'Payslips are available once the payroll card is approved.',
    code: 'INVALID_TRANSITION',
  })
}

/**
 * 대장의 명세서입니다(행 순서). 새 명세서는 마감된 대장에만 있으므로 마감 전이면 부르지 않고 비어 있습니다.
 * 새 목록은 한 번에 다 주고(페이지 없음), 대장 하나의 행 수만큼입니다.
 */
async function payslipsOf(context: SignedInContext, ledger: PayrollLedger): Promise<Payslip[]> {
  if (ledger.status !== 'CLOSED') return []
  const query = new URLSearchParams({ ledgerId: ledger.id })
  return (await read<{ items: Payslip[] }>(await upstream(context, 'GET', `/v1/payslips?${query}`))).items
}

function byRow(payslips: readonly Payslip[]): Map<string, Payslip> {
  return new Map(payslips.map((payslip) => [payslip.rowId, payslip]))
}

/**
 * 근로소득 행 직원의 HR 이메일입니다. 새 API가 명세서를 보내는 주소입니다(현행의 명세서 이메일 덮어쓰기는 없음).
 *
 * 직원을 읽을 권한(`employee:read`)이 없으면 주소를 모르는 것으로 보고 `undefined`입니다. 새 권한 모델에서 그 사용자에게
 * 직원 이메일을 보여 주지 않고, 명세서 화면은 막지 않으려는 것입니다. 이메일은 로그에 남기지 않습니다.
 */
async function emailsOf(
  context: SignedInContext,
  rows: readonly PayrollRow[],
): Promise<ReadonlyMap<string, string> | undefined> {
  if (!rows.some((row) => isWageRow(row) && row.employeeId !== null)) return new Map()
  try {
    const employees = await allWageEmployees(context)
    return new Map(
      employees.flatMap((employee) => (employee.email === undefined ? [] : [[employee.id, employee.email]])),
    )
  } catch (error) {
    if (error instanceof LegacyError && error.body.code === 'PERMISSION_DENIED') return undefined
    throw error
  }
}

function emailOf(row: PayrollRow, emails: ReadonlyMap<string, string> | undefined): string | null {
  return row.employeeId === null ? null : (emails?.get(row.employeeId) ?? null)
}

/**
 * 발송 실패가 결과를 모르는 실패인지입니다. 참이면 BFF가 키를 24시간 기억해, 재시도가 같은 키로 가서 새 API가 재응답하거나
 * 남은 명세서만 이어 보내게 합니다.
 *
 * - 시간 초과·연결 실패·5xx(예: 503 `PAYSLIP_SEND_INTERRUPTED`)는 일부가 나갔을 수 있습니다
 * - 409 `IDEMPOTENCY_KEY_IN_PROGRESS`는 같은 키의 앞 발송(보통 BFF가 시간 초과로 끝낸 것)이 새 API에서 아직 보내는 중이라는 뜻입니다.
 *   창(60초)만 기억하면 그 뒤 재시도가 새 키로 가서 이미 받은 사람에게 다시 보냅니다. 지금 SQLite 배포의 새 API는 잠금 때문에 이
 *   409를 주지 않지만(메모리 저장소만), 발송을 작업자로 옮기면 주므로 미리 막아 둡니다
 * - 그 밖의 4xx(마감이 풀려 404 → 409 등)는 아무것도 나가지 않았습니다
 */
export function isUncertainSendFailure(error: unknown): boolean {
  if (!(error instanceof LegacyError)) return true
  return error.status >= 500 || error.body.code === 'IDEMPOTENCY_KEY_IN_PROGRESS'
}

/**
 * 명세서를 보냅니다. 새 `:send`는 같은 회사·사용자·키면 처음 작업을 재응답하고(본문이 다르면 422), 처리 중이면 409를 줍니다.
 * 키가 사용자 단위라 세션이 다른 같은 사용자끼리는 섞이므로, 어떤 키든 세션·대상에 묶어 넘깁니다.
 *
 * - 현행 클라이언트처럼 키가 없으면 세션·명세서 집합의 지문으로 BFF가 키를 정하고 창 안에서 다시 씁니다({@link IdempotencyKeys}).
 *   작업 전체가 실패했으면(나간 메일 없음) 키를 기억하지 않아 다시 누르면 실제로 다시 보냅니다. 결과를 모르는 실패(시간 초과·5xx·처리
 *   중 409)는 24시간 동안 같은 키를 써서 새 API가 재응답하거나 이어 보내게 합니다({@link isUncertainSendFailure})
 * - 클라이언트가 `Idempotency-Key`를 보내면 `bff-client:<SHA-256(세션·키·명세서)>`로 바꿔 넘깁니다. 같은 세션이 같은 키로 같은
 *   대상을 다시 보낼 때만 재응답이고, 다른 세션이나 다른 명세서에 같은 키를 써도 남의 작업을 받거나 422를 보지 않습니다
 * - 같은 지문의 요청은 한 번에 하나씩 갑니다. 제한 시간은 발송용(`sendTimeoutMs`, 기본 2분)입니다
 * - 새 API가 명세서를 찾지 못하면(그사이 마감이 풀림) 현행처럼 409입니다. 앞 발송이 아직 처리 중인 409
 *   `IDEMPOTENCY_KEY_IN_PROGRESS`는 그대로 줍니다
 */
async function send(context: SignedInContext, payslipIds: readonly string[]): Promise<PayslipSendJob> {
  const sendWith = async (key: string) => {
    const response = await callApi(
      context.deps,
      context.sessionId,
      context.params['companyId'],
      'POST',
      '/v1/payslips:send',
      {
        body: { payslipIds },
        headers: { 'idempotency-key': key },
        send: true,
      },
    )
    if (response.status === 404) throw notClosed()
    return read<PayslipSendJob>(response)
  }
  const keys = context.deps.idempotencyKeys
  // 명세서 ID는 카드의 행 순서라(새 목록 순서) 같은 선택이면 요청의 `row_ids` 순서와 상관없이 같은 지문입니다.
  // 명세서 ID는 회사 안에서 유일하고 대장 하나에 속하므로 대장 ID는 넣지 않습니다.
  const target = [context.sessionId, ...payslipIds]
  const clientKey = context.request.headers.get('idempotency-key')?.trim()
  if (clientKey !== undefined && clientKey !== '') {
    const bound = IdempotencyKeys.fingerprint(['client', clientKey, ...target])
    return keys.serial(bound, () => sendWith(`${CLIENT_KEY_PREFIX}:${bound}`))
  }
  return keys.run(
    IdempotencyKeys.fingerprint(target),
    SEND_KEY_PREFIX,
    sendWith,
    (job) => job.status !== 'FAILED',
    isUncertainSendFailure,
  )
}

/**
 * 현행 급여카드 명세서(급여명세서)입니다. 현행은 근로소득 행만 다뤘습니다.
 *
 * | 현행 (`/api/company/:companyId/payroll/cards/:cardId` 아래) | 새 API |
 * |---|---|
 * | `GET payslip/` | `GET /v1/payroll-ledgers/{id}`, `…/rows`, `GET /v1/payslips?ledgerId=`(마감된 대장), `GET /v1/employees?kind=WAGE`(이메일) |
 * | `POST payslip/` | 없음. 바꾸지 않는 값만 받고 이메일 덮어쓰기·계산식은 422 |
 * | `GET payslip/wage-salary/notifications/` | `GET /v1/payslips?ledgerId=`의 `delivery` |
 * | `POST payslip/wage-salary/notifications/` | `POST /v1/payslips:send` (`Idempotency-Key`) |
 * | `POST payslip/wage-salary/copy-payment-formulas/` | 없음. 계산식 문구가 없어 언제나 빈 결과 |
 *
 * 현행 발송은 고객·세무 대리인 모두 했으므로(현행 `sendPayslips`의 `actors: ['client', 'agency']`) 확정·해제와 달리 막지 않습니다.
 */
export const payslipRoutes: readonly Route[] = [
  {
    method: 'GET',
    path: `${CARD}/payslip`,
    auth: true,
    handle: async (context) => {
      const { ledger } = await ledgerOf(context)
      const [rows, parent, payslips] = await Promise.all([
        rowsOf(context, ledger),
        parentOf(context, ledger),
        payslipsOf(context, ledger),
      ])
      const emails = await emailsOf(context, rows)
      const slips = byRow(payslips)
      return json({
        card: toLegacySummary(ledger, rows, parent),
        wage_salary: rows
          .filter(isWageRow)
          .map((row) => toLegacyPayslipRow(ledger, row, slips.get(row.id), emailOf(row, emails))),
      })
    },
  },
  {
    method: 'POST',
    path: `${CARD}/payslip`,
    auth: true,
    handle: async (context) => {
      const entries = parsePayslipSave(await readObject(context.request))
      const { ledger } = await ledgerOf(context)
      const rows = await rowsOf(context, ledger)
      const wageRows = new Map(rows.filter(isWageRow).map((row) => [row.id, row]))
      for (const entry of entries) {
        if (!wageRows.has(entry.id)) {
          throw new LegacyError(404, { detail: `Wage row ${entry.id} is not on this payroll card.`, code: 'NOT_FOUND' })
        }
      }
      const withEmail = entries.filter((entry) => entry.email !== undefined)
      if (withEmail.length > 0) {
        // 현행 화면이 받은 주소를 그대로 돌려보내면 바뀐 것이 없으므로 받습니다. 다른 주소는 둘 자리가 없어 422입니다.
        // 직원을 읽을 수 없으면 화면도 주소를 받지 못했으므로(`null`) 어떤 주소든 422입니다.
        const emails = await emailsOf(context, rows)
        for (const entry of withEmail) {
          const row = wageRows.get(entry.id) as PayrollRow
          if (entry.email !== emailOf(row, emails)) throw unsupportedEmail(entry.index)
        }
      }
      return json({ saved: entries.length })
    },
  },
  {
    method: 'GET',
    path: `${CARD}/payslip/wage-salary/notifications`,
    auth: true,
    handle: async (context) => {
      const { ledger } = await ledgerOf(context)
      const [rows, payslips] = await Promise.all([rowsOf(context, ledger), payslipsOf(context, ledger)])
      const slips = byRow(payslips)
      return json({ results: rows.filter(isWageRow).map((row) => toLegacyNotification(row, slips.get(row.id))) })
    },
  },
  {
    method: 'POST',
    path: `${CARD}/payslip/wage-salary/notifications`,
    auth: true,
    handle: async (context) => {
      const rowIds = parseRowIds(await readObject(context.request))
      // 현행 순서: 본문 모양 → 카드 404 → 마감 전 409 → 카드에 없는 행 422.
      const { ledger } = await ledgerOf(context)
      if (ledger.status !== 'CLOSED') throw notClosed()
      assertRowIdFormat(rowIds)
      const payslips = await payslipsOf(context, ledger)
      // 현행 발송은 근로소득 행만이 아니라 카드의 어느 행이든 받았습니다. 결과는 카드의 행 순서입니다.
      const wanted = new Set(rowIds)
      const targets = payslips.filter((payslip) => wanted.has(payslip.rowId))
      if (targets.length !== wanted.size) throw rowsNotOnCard()
      const job = await send(
        context,
        targets.map((payslip) => payslip.id),
      )
      return json({ results: toLegacySendResults(job, new Map(targets.map((payslip) => [payslip.id, payslip.rowId]))) })
    },
  },
  {
    method: 'POST',
    path: `${CARD}/payslip/wage-salary/copy-payment-formulas`,
    auth: true,
    handle: async (context) => {
      // 새 API에는 계산식 문구가 없어 옮길 것이 없습니다. 카드가 있는지만 봅니다.
      await ledgerOf(context)
      return json({ results: {} })
    },
  },
]
