import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { Authentication } from '../../identity-access/authentication.ts'
import { ACCESS_ERRORS } from '../payroll-problems.ts'
import { YearFromString } from '../payroll-schema.ts'

const Amounts = Schema.Struct({ wage: Schema.Int, daily: Schema.Int, business: Schema.Int, other: Schema.Int })

/** 인건비 보고서 응답입니다. */
export const LaborCostReportSchema = Schema.Struct({
  year: Schema.Int,
  hasData: Schema.Boolean,
  months: Schema.Array(
    Schema.Struct({
      month: Schema.String,
      amounts: Amounts,
      total: Schema.Int,
      employerInsurance: Schema.Int,
      totalWithEmployerInsurance: Schema.Int,
      headcount: Amounts,
      employment: Schema.Struct({ employed: Schema.Int, joined: Schema.Int, left: Schema.Int }),
    }),
  ),
  totals: Schema.Struct({
    amounts: Amounts,
    total: Schema.Int,
    employerInsurance: Schema.Int,
    totalWithEmployerInsurance: Schema.Int,
    headcount: Amounts,
  }),
  updatedAt: Schema.NullOr(Schema.String),
})

/** 연간 인건비 보고서입니다(현행 세무 > 인건비 내역). 데이터는 급여가 소유합니다. */
export class LaborCostReportsGroup extends HttpApiGroup.make('labor-cost-reports')
  .add(
    HttpApiEndpoint.get('get', '/labor-cost-reports/:year', {
      params: { year: YearFromString },
      success: LaborCostReportSchema,
      error: ACCESS_ERRORS,
    }),
  )
  .middleware(Authentication) {}
