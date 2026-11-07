import { readObject } from '../legacy-body.ts'
import { LegacyError } from '../legacy-error.ts'
import { json } from '../router.ts'
import type { Route } from '../router.ts'
import type { PayrollRow } from '../upstream.types.ts'
import { toLegacySummary } from './ledgers.mapping.ts'
import { ledgerOf, parentOf, rowsOf } from './ledgers.routes.ts'
import { byRow, emailOf, emailsOf, payslipsOf, sendRows } from './payslip-send.ts'
import {
  isWageRow,
  parsePayslipSave,
  parseRowIds,
  toLegacyNotification,
  toLegacyPayslipRow,
  unsupportedEmail,
} from './payslips.mapping.ts'

const CARD = '/api/company/:companyId/payroll/cards/:cardId'

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
 * 명세서 읽기·발송 키는 BPO 명세서와 함께 쓰는 `payslip-send.ts`에 있습니다.
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
      const wageRows = rows.filter(isWageRow)
      const emails = await emailsOf(context, wageRows, 'WAGE')
      const slips = byRow(payslips)
      return json({
        card: toLegacySummary(ledger, rows, parent),
        wage_salary: wageRows.map((row) => toLegacyPayslipRow(ledger, row, slips.get(row.id), emailOf(row, emails))),
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
        const emails = await emailsOf(context, [...wageRows.values()], 'WAGE')
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
      const { results } = await sendRows(context, ledger, rowIds, async () => undefined)
      return json({ results })
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
