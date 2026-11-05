import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { IdSchema } from '../../../shared/ids/id-schema.ts'
import { Authentication } from '../../identity-access/authentication.ts'
import { ACCESS_ERRORS, RateTableIdNotFound, RateTableNotFound } from '../payroll-problems.ts'
import { YearMonthString } from '../payroll-schema.ts'
import { PayrollRowInputSchema, PayrollRowResultSchema, EmployeeSnapshotSchema } from '../rows/payroll-row-input.ts'
import { DeductionMethodsSchema, PremiumMultipliersSchema } from '../settings/payroll-setting.ts'
import { RateTable, ReferenceCodeSchema } from './rate-table.ts'

/** 급여 기준표(요율·한도)와 참조 코드입니다. 회사와 무관한 읽기 전용 참조 데이터입니다. */
export class RateTablesGroup extends HttpApiGroup.make('rate-tables')
  .add(
    HttpApiEndpoint.get('list', '/rate-tables', {
      query: { month: Schema.optionalKey(YearMonthString) },
      success: Schema.Struct({ items: Schema.Array(RateTable) }),
      error: [...ACCESS_ERRORS, RateTableNotFound],
    }),
  )
  .add(
    HttpApiEndpoint.get('get', '/rate-tables/:rateTableId', {
      params: { rateTableId: IdSchema('rateTable') },
      success: RateTable,
      error: [...ACCESS_ERRORS, RateTableIdNotFound],
    }),
  )
  .add(
    HttpApiEndpoint.get('referenceCodes', '/payroll-reference-codes', {
      query: { month: Schema.optionalKey(YearMonthString) },
      success: Schema.Struct({
        businessIncome: Schema.Array(ReferenceCodeSchema),
        otherIncome: Schema.Array(ReferenceCodeSchema),
      }),
      error: ACCESS_ERRORS,
    }),
  )
  .middleware(Authentication) {}

/** `POST /payroll-calculator:simulate` 본문입니다. 저장하지 않고 한 행을 계산합니다. */
export const SimulationRequest = Schema.Struct({
  attributionMonth: YearMonthString,
  /** 지급월입니다. 없으면 귀속월과 같습니다. 원천세는 지급월 기준표를 씁니다. */
  paymentMonth: Schema.optionalKey(YearMonthString),
  /** 없으면 5인 이상 기본 배수입니다. */
  multipliers: Schema.optionalKey(PremiumMultipliersSchema),
  /** 없으면 4대보험은 모두 요율, 소득세는 간이세액표입니다. */
  deductionMethods: Schema.optionalKey(DeductionMethodsSchema),
  /** 근로 행의 부양가족·원천징수 비율·소정근로시간입니다. 없으면 본인 1인·100%·209시간입니다. */
  employee: Schema.optionalKey(EmployeeSnapshotSchema),
  row: PayrollRowInputSchema,
})

/** 급여 계산기입니다(현행 급여·일용·사업·기타 계산기 네 탭). */
export class PayrollCalculatorGroup extends HttpApiGroup.make('payroll-calculator')
  .add(
    HttpApiEndpoint.post('simulate', '/payroll-calculator::simulate', {
      payload: SimulationRequest,
      success: PayrollRowResultSchema,
      error: [...ACCESS_ERRORS, RateTableNotFound],
    }),
  )
  .middleware(Authentication) {}
