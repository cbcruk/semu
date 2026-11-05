import { Context, Effect, Layer } from 'effect'

/** 소득 형태별 인건비(세전)입니다. */
export interface LaborCostByIncomeType {
  wageAmount: number
  dailyWageAmount: number
  businessIncomeAmount: number
  otherIncomeAmount: number
}

/** 한 달의 인건비와 재직자 추이입니다. */
export interface LaborCostMonth {
  /** `YYYY-MM`입니다. */
  month: string
  amounts: LaborCostByIncomeType
  /** 소득 형태별 지급 인원입니다. */
  paidHeadcount: LaborCostByIncomeType
  /** 근로소득 직원 기준 월말 재직자 수입니다. 휴직자를 포함합니다. */
  employedCount: number
  joinedCount: number
  leftCount: number
}

/**
 * 인건비 보고서가 읽는 Payroll 포트입니다 (`docs/reference/spec/bookkeeping.md` 4.8).
 *
 * 마감(계산 완료)된 급여대장만 집계하고, 재계산 중인 대장은 빠집니다. 집계 책임은 Payroll에 있고
 * Bookkeeping은 세무 보고서 화면에 그대로 싣습니다.
 */
export class LaborCostSource extends Context.Service<
  LaborCostSource,
  {
    monthly(companyId: string, year: number): Effect.Effect<ReadonlyArray<LaborCostMonth>>
  }
>()('semu/bookkeeping/LaborCostSource') {
  /** 정해 둔 달만 돌려주는 가짜입니다. 기본은 빈 목록입니다. */
  static readonly layerFake = (months: ReadonlyArray<LaborCostMonth> = []) =>
    Layer.succeed(
      LaborCostSource,
      LaborCostSource.of({
        monthly: (_companyId, year) => Effect.succeed(months.filter((row) => row.month.startsWith(`${year}-`))),
      }),
    )
}
