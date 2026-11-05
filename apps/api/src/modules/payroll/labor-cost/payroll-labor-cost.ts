import { Context, Effect, Layer } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { PayrollLedgerRepository } from '../ledgers/payroll-ledger-repository.ts'
import { PayrollEmployeeDirectory } from '../ports/payroll-employee-directory.ts'
import { buildLaborCost, laborCostRowsOf } from './labor-cost.ts'
import type { LaborCostReport } from './labor-cost.types.ts'

/**
 * 급여가 Bookkeeping에 내보내는 인건비 조회입니다. `payroll.public.ts`로 공개합니다.
 *
 * Bookkeeping은 급여 저장소를 직접 읽지 않고 이 서비스로 월별 인건비를 받습니다.
 */
export class PayrollLaborCost extends Context.Service<
  PayrollLaborCost,
  {
    /** 한 해의 월별 인건비입니다. 귀속월 기준이고 계산 확정 이후 대장만 셉니다. */
    monthly(companyId: Id<'company'>, year: number): Effect.Effect<LaborCostReport>
  }
>()('semu/payroll/PayrollLaborCost') {
  /** 급여대장 저장소와 HR 포트로 만듭니다. */
  static readonly layer = Layer.effect(
    PayrollLaborCost,
    Effect.gen(function* () {
      const ledgers = yield* PayrollLedgerRepository
      const directory = yield* PayrollEmployeeDirectory
      return PayrollLaborCost.of({
        monthly: (companyId, year) =>
          Effect.gen(function* () {
            const rows = laborCostRowsOf(yield* ledgers.list(companyId), year)
            const employment = new Map<string, { employed: number; joined: number; left: number }>()
            for (let index = 1; index <= 12; index++) {
              const month = `${year}-${String(index).padStart(2, '0')}`
              employment.set(month, yield* directory.employmentTrend(companyId, month))
            }
            return buildLaborCost(rows, year, employment)
          }),
      })
    }),
  )
}
