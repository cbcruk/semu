import { Context, Layer, Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { problemType } from '../../../shared/problem/problem.ts'
import { CalendarDate } from '../../../shared/time/date-schemas.ts'
import { EmployeeId, Violations } from '../shared/hr-schemas.ts'
import { makeMemoryTable, type TenantTable } from '../shared/tenant-table.ts'

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const Won = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

const ReductionType = Schema.Literals(['SMALL_BUSINESS', 'RETURNING_KOREAN_TALENT', 'FOREIGN_TECHNICIAN'])
const ReductionApplication = Schema.Literals(['PAYROLL', 'YEAR_END'])

const terms = {
  /** 간이세액표의 공제대상 가족 수입니다. 본인을 포함합니다. */
  dependantsCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  childrenAged8To20Count: Count,
  /** `TAX_TABLE`은 간이세액표, `MANUAL`은 `manualIncomeTax`를 그대로 씁니다. */
  calcMethod: Schema.Literals(['TAX_TABLE', 'MANUAL']),
  manualIncomeTax: Schema.optionalKey(Won),
  studentLoan: Schema.optionalKey(
    Schema.Struct({
      monthlyAmount: Schema.optionalKey(Won),
      startDate: Schema.optionalKey(CalendarDate),
      endDate: Schema.optionalKey(CalendarDate),
    }),
  ),
}

/** 소득세 공제 설정 저장 본문입니다. `effectiveFrom`부터 적용하고, 같은 날짜의 설정은 덮어씁니다. */
export const TaxWithholdingInput = Schema.Struct({
  effectiveFrom: CalendarDate,
  ...terms,
  /** 소득세액 조정비율(80/100/120%)입니다. 없으면 100%(`1000000`). */
  adjustmentRatePpm: Schema.optionalKey(Schema.Int),
  reduction: Schema.optionalKey(
    Schema.Struct({
      type: ReductionType,
      /** 유형에 사유가 하나뿐이면 비워도 됩니다. */
      reasonCode: Schema.optionalKey(Schema.String),
      application: Schema.optionalKey(ReductionApplication),
      startDate: Schema.optionalKey(CalendarDate),
      endDate: Schema.optionalKey(CalendarDate),
      /** 비우면 사유의 법정 감면율입니다. */
      ratePpm: Schema.optionalKey(Schema.Int),
    }),
  ),
})

/** 소득세 공제 설정 저장 본문의 타입입니다. */
export type TaxWithholdingInput = typeof TaxWithholdingInput.Type

/** 기준일에 적용되는 소득세 공제 설정입니다. 감면은 검증을 통과해 사유와 감면율이 채워진 값입니다. */
export const TaxWithholding = Schema.Struct({
  employeeId: EmployeeId,
  effectiveFrom: CalendarDate,
  ...terms,
  adjustmentRatePpm: Schema.Int,
  reduction: Schema.optionalKey(
    Schema.Struct({
      type: ReductionType,
      reasonCode: Schema.String,
      application: ReductionApplication,
      startDate: CalendarDate,
      endDate: CalendarDate,
      ratePpm: Schema.Int,
    }),
  ),
  /** 직원의 공제 설정 이력 전체의 버전입니다. 다음 `PUT`의 `If-Match`로 보냅니다. */
  version: Schema.Int,
  updatedAt: Schema.String,
})

/** 소득세 공제 설정 응답의 타입입니다. */
export type TaxWithholding = typeof TaxWithholding.Type

/** 이력 한 건입니다. */
export type TaxWithholdingEntry = Omit<TaxWithholding, 'employeeId' | 'version' | 'updatedAt'>

/** 직원 한 명의 소득세 공제 설정 이력입니다. ID는 직원 ID와 같습니다. */
export interface TaxWithholdingRecord {
  id: Id<'employee'>
  companyId: Id<'company'>
  /** `effectiveFrom` 오름차순입니다. */
  entries: ReadonlyArray<TaxWithholdingEntry>
  version: number
  updatedAt: string
}

/** 소득세 공제 설정 저장소입니다. */
export class TaxWithholdingRepository extends Context.Service<
  TaxWithholdingRepository,
  TenantTable<TaxWithholdingRecord>
>()('semu/hr/TaxWithholdingRepository') {
  /** `seed`로 시작해 프로세스 메모리에 공제 설정을 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<TaxWithholdingRecord> = []) =>
    Layer.effect(TaxWithholdingRepository, makeMemoryTable(seed))
}

/** 기준일에 적용되는 소득세 공제 설정이 없습니다. */
export class TaxWithholdingNotFound extends HttpApiError.Problem<TaxWithholdingNotFound>()(
  'TaxWithholdingNotFound',
  { type: problemType('TAX_WITHHOLDING_NOT_FOUND'), status: 404, title: 'Tax withholding settings not found' },
  { code: Schema.tag('TAX_WITHHOLDING_NOT_FOUND') },
) {}

/** 소득세 공제 설정이 업무 규칙을 어겼습니다. */
export class TaxWithholdingInvalid extends HttpApiError.Problem<TaxWithholdingInvalid>()(
  'TaxWithholdingInvalid',
  { type: problemType('TAX_WITHHOLDING_INVALID'), status: 422, title: 'Tax withholding settings violate a rule' },
  { code: Schema.tag('TAX_WITHHOLDING_INVALID'), violations: Violations },
) {}
