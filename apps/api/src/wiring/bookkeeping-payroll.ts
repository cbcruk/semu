import { Effect, Layer } from 'effect'
import type { Id } from '../shared/ids/ids.types.ts'
import { LaborCostSource } from '../modules/bookkeeping/bookkeeping.public.ts'
import type { LaborCostByIncomeType, LaborCostMonth } from '../modules/bookkeeping/bookkeeping.public.ts'
import { PayrollLaborCost } from '../modules/payroll/payroll.public.ts'
import type { LaborCostMonth as PayrollLaborCostMonth } from '../modules/payroll/payroll.public.ts'

/**
 * Bookkeeping의 `LaborCostSource` 포트를 Payroll의 `PayrollLaborCost`로 구현합니다.
 *
 * Payroll이 귀속월 기준으로 계산 확정 이후 대장만 집계한 열두 달을 그대로 옮깁니다. 재직·입사·퇴사 인원은 Payroll이 HR에서 읽은 값입니다.
 */
export const BookkeepingLaborCostFromPayroll: Layer.Layer<LaborCostSource, never, PayrollLaborCost> = Layer.effect(
  LaborCostSource,
  Effect.gen(function* () {
    const payroll = yield* PayrollLaborCost
    return LaborCostSource.of({
      monthly: (companyId, year) =>
        payroll
          .monthly(companyId as Id<'company'>, year)
          .pipe(Effect.map((report) => report.months.map(laborCostMonthOf))),
    })
  }),
)

function laborCostMonthOf(month: PayrollLaborCostMonth): LaborCostMonth {
  return {
    month: month.month,
    amounts: byIncomeType(month.amounts),
    paidHeadcount: byIncomeType(month.headcount),
    employedCount: month.employment.employed,
    joinedCount: month.employment.joined,
    leftCount: month.employment.left,
  }
}

function byIncomeType(values: PayrollLaborCostMonth['amounts']): LaborCostByIncomeType {
  return {
    wageAmount: values.wage,
    dailyWageAmount: values.daily,
    businessIncomeAmount: values.business,
    otherIncomeAmount: values.other,
  }
}
