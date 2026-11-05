import { Context, Layer, Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import { CalendarDate } from '../../../shared/time/date-schemas.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { problemType } from '../../../shared/problem/problem.ts'
import { EmployeeId, Violations, WorkContractId } from '../shared/hr-schemas.ts'
import { makeTenantTable, TableFactory, type TenantTable } from '../../../shared/persistence/record-table.ts'
import type { ContractType, TermLimitExemption as TermLimitExemptionCode } from './work-contract-period.types.ts'

/** 수습 조건입니다. 지급률은 ppm(`1_000_000` = 100%)입니다. */
export const Probation = Schema.Struct({
  months: Schema.optionalKey(Schema.Int),
  payRatePpm: Schema.optionalKey(Schema.Int),
})

/** 기간제 사용기간 제한의 예외 사유입니다(기간제법 제4조 ① 단서). */
export const TermLimitExemption = Schema.Literals([
  'PROJECT_COMPLETION',
  'REPLACEMENT',
  'STUDY_OR_TRAINING',
  'PROFESSIONAL',
  'GOVERNMENT_JOB_PROGRAM',
  'OTHER_STATUTORY',
])

/** 근로계약 입력입니다. */
export const WorkContractInput = Schema.Struct({
  contractType: Schema.Literals(['PERMANENT', 'FIXED_TERM']),
  startDate: CalendarDate,
  endDate: Schema.optionalKey(CalendarDate),
  weeklyWorkHours: Schema.optionalKey(Schema.Number),
  probation: Schema.optionalKey(Probation),
  /** 한국표준직업분류 코드입니다. 대분류 9(단순노무)면 수습 감액을 받지 않습니다. */
  standardOccupationCode: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^\d{1,5}$/))),
  termLimitExemption: Schema.optionalKey(TermLimitExemption),
})

/** 근로계약 응답입니다. */
export const WorkContract = Schema.Struct({
  id: WorkContractId,
  employeeId: EmployeeId,
  ...WorkContractInput.fields,
  /** 기준일(오늘)의 계약 상태입니다. */
  status: Schema.Literals(['SCHEDULED', 'ACTIVE', 'EXPIRED']),
  createdAt: Schema.String,
})

/** 근로계약 응답의 타입입니다. */
export type WorkContract = typeof WorkContract.Type

/** 무기계약 전환 판정입니다. */
export const IndefiniteConversionView = Schema.Struct({
  isTarget: Schema.Boolean,
  status: Schema.Literals(['NONE', 'APPROACHING', 'EXCEEDED']),
  isExempt: Schema.Boolean,
  exemptReason: Schema.optionalKey(Schema.Literals(['AGED_55_OR_OVER', ...TermLimitExemption.literals])),
  chainStartDate: Schema.optionalKey(CalendarDate),
  chainEndDate: Schema.optionalKey(CalendarDate),
  totalContractDays: Schema.Int,
  conversionDate: Schema.optionalKey(CalendarDate),
  daysUntilConversion: Schema.optionalKey(Schema.Int),
})

/** 저장하는 근로계약입니다. */
export interface WorkContractRecord {
  id: Id<'workContract'>
  companyId: Id<'company'>
  employeeId: Id<'employee'>
  contractType: ContractType
  startDate: string
  endDate?: string | undefined
  weeklyWorkHours?: number | undefined
  probation?: { months?: number; payRatePpm?: number } | undefined
  standardOccupationCode?: string | undefined
  termLimitExemption?: TermLimitExemptionCode | undefined
  createdAt: string
}

/** 근로계약 저장소입니다. */
export class WorkContractRepository extends Context.Service<WorkContractRepository, TenantTable<WorkContractRecord>>()(
  'semu/hr/WorkContractRepository',
) {
  /** `hr_work_contracts` 표에 둡니다. 표가 비어 있으면 `seed`로 시작합니다. 저장 방식은 {@link TableFactory}가 정합니다. */
  static readonly layer = (seed: ReadonlyArray<WorkContractRecord> = []) =>
    Layer.effect(WorkContractRepository, makeTenantTable<WorkContractRecord>('hr_work_contracts', seed))

  /** `seed`로 시작해 프로세스 메모리에 근로계약을 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<WorkContractRecord> = []) =>
    WorkContractRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}

/** 근로계약 입력이 업무 규칙을 어겼습니다. */
export class WorkContractInvalid extends HttpApiError.Problem<WorkContractInvalid>()(
  'WorkContractInvalid',
  { type: problemType('WORK_CONTRACT_INVALID'), status: 422, title: 'Work contract violates a rule' },
  { code: Schema.tag('WORK_CONTRACT_INVALID'), violations: Violations },
) {}
