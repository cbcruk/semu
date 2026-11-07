import { readObject } from '../legacy-body.ts'
import { legacyErrors } from '../legacy-error.ts'
import { json } from '../router.ts'
import type { Route, SignedInContext } from '../router.ts'
import type { PayrollLedger, PayrollRow } from '../upstream.types.ts'
import {
  inGroup,
  parsePayslipGroup,
  toBpoCard,
  toBpoPayslipDetail,
  toBpoPayslipSummary,
  toBpoSendResults,
} from './bpo-payslips.mapping.ts'
import type { PayslipGroup } from './bpo-payslips.mapping.ts'
import { ledgerOf, parentOf, rowsOf } from './ledgers.routes.ts'
import { byRow, emailOf, emailsOf, employeeEmail, payslipsOf, sendRows } from './payslip-send.ts'
import { parseRowIds } from './payslips.mapping.ts'

const CARD = '/api/company/:companyId/payroll/bpo/card/:cardId'

/** 경로의 대장과 묶음입니다. 현행 순서대로 카드 404가 묶음 404보다 먼저입니다. */
async function cardAndGroup(context: SignedInContext): Promise<{ ledger: PayrollLedger; group: PayslipGroup }> {
  const { ledger } = await ledgerOf(context)
  return { ledger, group: parsePayslipGroup(context.params['group']) }
}

/** 묶음의 행과 마감된 대장이면 그 명세서입니다. */
async function groupRows(
  context: SignedInContext,
  ledger: PayrollLedger,
  group: PayslipGroup,
): Promise<{ rows: PayrollRow[]; slips: ReturnType<typeof byRow> }> {
  const [rows, payslips] = await Promise.all([rowsOf(context, ledger), payslipsOf(context, ledger)])
  return { rows: rows.filter((row) => inGroup(row, group)), slips: byRow(payslips) }
}

/**
 * 현행 BPO 급여명세서(급여 정산 > 급여 명세서 관리)입니다.
 *
 * | 현행 (`/api/company/:companyId/payroll/bpo/card/:cardId` 아래) | 새 API |
 * |---|---|
 * | `GET :group/payslip/` | `GET /v1/payroll-ledgers/{id}`, `…/rows`, `GET /v1/payslips?ledgerId=`(마감된 대장), `GET /v1/employees`(모든 종류, 이메일) |
 * | `GET :group/payslip/:rowId/` | 같음. 명세서는 행 ID로 목록에서 찾고, 이메일은 `GET /v1/employees/{id}` 하나 |
 * | `POST payslip/send/` | `GET /v1/payslips?ledgerId=`로 행 → 명세서 ID, `POST /v1/payslips:send` (`Idempotency-Key`) |
 * | `POST payslip/download/` | 없음(현행 404). 새 API에 명세서 PDF가 없음 |
 *
 * 현행 BPO 명세서 읽기는 행위자를 보지 않았고 발송은 고객·담당자 모두 했으므로(`sendPayslips`의 `actors: ['client', 'agency']`)
 * BFF가 막지 않습니다. 새 API의 `payslip:read`·`payslip:send` 권한이 봅니다. 발송 키는 현행 급여카드 명세서와 같은
 * `payslip-send.ts`를 씁니다.
 */
export const bpoPayslipRoutes: readonly Route[] = [
  {
    method: 'GET',
    path: `${CARD}/:group/payslip`,
    auth: true,
    handle: async (context) => {
      const { ledger, group } = await cardAndGroup(context)
      const { rows, slips } = await groupRows(context, ledger, group)
      const emails = await emailsOf(context, rows, undefined)
      return json({ results: rows.map((row) => toBpoPayslipSummary(row, slips.get(row.id), emailOf(row, emails))) })
    },
  },
  {
    method: 'GET',
    path: `${CARD}/:group/payslip/:rowId`,
    auth: true,
    handle: async (context) => {
      const { ledger, group } = await cardAndGroup(context)
      const { rows, slips } = await groupRows(context, ledger, group)
      // 현행처럼 다른 묶음의 행도 없는 행과 같은 404입니다.
      const row = rows.find((candidate) => candidate.id === context.params['rowId'])
      if (row === undefined) throw legacyErrors.notFound('Payroll row')
      return json(toBpoPayslipDetail(ledger, row, slips.get(row.id), await employeeEmail(context, row)))
    },
  },
  {
    method: 'POST',
    path: `${CARD}/payslip/send`,
    auth: true,
    handle: async (context) => {
      const rowIds = parseRowIds(await readObject(context.request))
      // 현행 순서: 본문 모양 → 카드 404 → 마감 전 409 → 카드에 없는 행 422.
      const { ledger } = await ledgerOf(context)
      // 현행 응답의 카드 머리에 행 집계가 들어가므로 보내기 전에 행과 부모 카드를 함께 읽습니다. 읽기가 실패하면 보내지 않습니다.
      const { results, alongside } = await sendRows(context, ledger, rowIds, () =>
        Promise.all([rowsOf(context, ledger), parentOf(context, ledger)]),
      )
      const [rows, parent] = alongside
      return json({ results: toBpoSendResults(results), card: toBpoCard(ledger, rows, parent) })
    },
  },
]
