import { allEmployees } from '../hr/hr.routes.ts'
import { upstream } from '../hr/employee-scope.ts'
import { IdempotencyKeys } from '../idempotency.ts'
import { LegacyError } from '../legacy-error.ts'
import { callApi, readJson } from '../upstream.ts'
import type { SignedInContext } from '../router.ts'
import type { Employee, Payslip, PayslipSendJob, PayrollLedger, PayrollRow } from '../upstream.types.ts'
import { read } from './ledgers.routes.ts'
import { assertRowIdFormat, rowsNotOnCard, toLegacySendResults } from './payslips.mapping.ts'
import type { LegacySendResult } from './payslips.mapping.ts'

/**
 * 현행 급여카드 명세서(`cards/:c/payslip/…`)와 BPO 명세서(`bpo/card/:c/…/payslip`)가 함께 쓰는 명세서 읽기와 발송입니다.
 *
 * 두 현행 화면은 같은 새 명세서(`/v1/payslips`)를 읽고 같은 `:send`로 보내므로, 발송 키(세션·대상 묶기, 결과를 모르는 실패의
 * 24시간 기억, 한 번에 하나씩)도 하나입니다. 두 경로가 같은 명세서를 보내면 같은 지문이라 서로 재응답을 받습니다.
 */

/** BFF가 만든 `Idempotency-Key`의 앞부분입니다. 새 API 쪽에서 현행 화면의 발송을 알아보게 합니다. */
const SEND_KEY_PREFIX = 'bff-payslip-send'

/** 클라이언트 키를 세션·대상에 묶은 키의 앞부분입니다. */
const CLIENT_KEY_PREFIX = 'bff-client'

/** 마감 전 카드의 명세서 발송 거절입니다. 현행 서버와 같은 문구입니다. */
export function notClosed(): LegacyError {
  return new LegacyError(409, {
    detail: 'Payslips are available once the payroll card is approved.',
    code: 'INVALID_TRANSITION',
  })
}

/**
 * 대장의 명세서입니다(행 순서). 새 명세서는 마감된 대장에만 있으므로 마감 전이면 부르지 않고 비어 있습니다.
 * 새 목록은 한 번에 다 주고(페이지 없음), 대장 하나의 행 수만큼입니다.
 */
export async function payslipsOf(context: SignedInContext, ledger: PayrollLedger): Promise<Payslip[]> {
  if (ledger.status !== 'CLOSED') return []
  const query = new URLSearchParams({ ledgerId: ledger.id })
  return (await read<{ items: Payslip[] }>(await upstream(context, 'GET', `/v1/payslips?${query}`))).items
}

/** 행 ID → 명세서입니다. */
export function byRow(payslips: readonly Payslip[]): Map<string, Payslip> {
  return new Map(payslips.map((payslip) => [payslip.rowId, payslip]))
}

/**
 * 행 소득자의 HR 이메일입니다. 새 API가 명세서를 보내는 주소입니다(현행의 명세서 이메일 덮어쓰기는 없음).
 *
 * 직원을 읽을 권한(`employee:read`)이 없으면 주소를 모르는 것으로 보고 `undefined`입니다. 새 권한 모델에서 그 사용자에게
 * 직원 이메일을 보여 주지 않고, 명세서 화면은 막지 않으려는 것입니다. 직원에 이어진 행이 없으면 읽지 않습니다. 이메일은 로그에
 * 남기지 않습니다.
 *
 * @param rows 주소가 필요한 행만 넘깁니다.
 * @param kind 읽을 직원 종류입니다. 현행 급여카드 명세서는 근로소득 행만이라 `WAGE`, BPO 명세서는 모든 종류(`undefined`)입니다.
 */
export async function emailsOf(
  context: SignedInContext,
  rows: readonly PayrollRow[],
  kind: Employee['kind'] | undefined,
): Promise<ReadonlyMap<string, string> | undefined> {
  if (!rows.some((row) => row.employeeId !== null)) return new Map()
  try {
    const employees = await allEmployees(context, kind)
    return new Map(
      employees.flatMap((employee) => (employee.email === undefined ? [] : [[employee.id, employee.email]])),
    )
  } catch (error) {
    if (error instanceof LegacyError && error.body.code === 'PERMISSION_DENIED') return undefined
    throw error
  }
}

/**
 * 행 하나의 HR 이메일입니다. 미리보기처럼 행 하나만 필요할 때 직원 전체 대신 그 직원만 읽습니다.
 *
 * 직원에 이어지지 않았거나, 직원을 읽을 권한이 없거나({@link emailsOf}와 같음), 직원이 지워졌으면(404) `null`입니다.
 */
export async function employeeEmail(context: SignedInContext, row: PayrollRow): Promise<string | null> {
  if (row.employeeId === null) return null
  const response = await upstream(context, 'GET', `/v1/employees/${encodeURIComponent(row.employeeId)}`)
  if (response.status === 404) return null
  try {
    return (await readJson<Employee>(response)).email ?? null
  } catch (error) {
    if (error instanceof LegacyError && error.body.code === 'PERMISSION_DENIED') return null
    throw error
  }
}

/** 행의 HR 이메일입니다. 직원에 이어지지 않았거나 모르면 `null`입니다. */
export function emailOf(row: PayrollRow, emails: ReadonlyMap<string, string> | undefined): string | null {
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
 * 고른 행의 명세서를 보냅니다. 현행 발송은 카드의 어느 행이든 받았고, 결과는 카드의 행 순서이며 같은 행은 한 번입니다.
 *
 * 현행 순서대로 마감 전 409 → 새 행 ID 형식이 아닌 행 422(명세서를 읽기 전) → 카드에 없는 행 422(아무것도 보내기 전)입니다.
 * 본문 모양과 카드 404는 라우트가 먼저 봅니다.
 *
 * @param alongside 보내기 전에 명세서 목록과 함께 읽을 것입니다(BPO 응답의 카드 머리 등). 실패하면 아무것도 보내지 않습니다.
 */
export async function sendRows<A>(
  context: SignedInContext,
  ledger: PayrollLedger,
  rowIds: readonly string[],
  alongside: () => Promise<A>,
): Promise<{ results: LegacySendResult[]; alongside: A }> {
  if (ledger.status !== 'CLOSED') throw notClosed()
  assertRowIdFormat(rowIds)
  const [payslips, extra] = await Promise.all([payslipsOf(context, ledger), alongside()])
  const wanted = new Set(rowIds)
  const targets = payslips.filter((payslip) => wanted.has(payslip.rowId))
  if (targets.length !== wanted.size) throw rowsNotOnCard()
  const job = await send(
    context,
    targets.map((payslip) => payslip.id),
  )
  return {
    results: toLegacySendResults(job, new Map(targets.map((payslip) => [payslip.id, payslip.rowId]))),
    alongside: extra,
  }
}
