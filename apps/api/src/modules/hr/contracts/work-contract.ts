import { Context, Layer, Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { problemType } from '../../../shared/problem/problem.ts'
import { CalendarDate, EmployeeId, Violations, WorkContractId } from '../shared/hr-schemas.ts'
import { makeMemoryTable, type TenantTable } from '../shared/tenant-table.ts'
import type { ContractType } from './work-contract-period.types.ts'

/** 수습 조건입니다. 지급률은 ppm(`1_000_000` = 100%)입니다. */
export const Probation = Schema.Struct({
  months: Schema.optionalKey(Schema.Int),
  payRatePpm: Schema.optionalKey(Schema.Int),
})

/** 근로계약 입력입니다. */
export const WorkContractInput = Schema.Struct({
  contractType: Schema.Literals(['PERMANENT', 'FIXED_TERM']),
  startDate: CalendarDate,
  endDate: Schema.optionalKey(CalendarDate),
  weeklyWorkHours: Schema.optionalKey(Schema.Number),
  probation: Schema.optionalKey(Probation),
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
  exemptReason: Schema.optionalKey(Schema.Literal('AGED_55_OR_OVER')),
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
  createdAt: string
}

/** 근로계약 저장소입니다. */
export class WorkContractRepository extends Context.Service<WorkContractRepository, TenantTable<WorkContractRecord>>()(
  'semu/hr/WorkContractRepository',
) {
  /** `seed`로 시작해 프로세스 메모리에 근로계약을 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<WorkContractRecord> = []) =>
    Layer.effect(WorkContractRepository, makeMemoryTable(seed))
}

/** 근로계약 입력이 업무 규칙을 어겼습니다. */
export class WorkContractInvalid extends HttpApiError.Problem<WorkContractInvalid>()(
  'WorkContractInvalid',
  { type: problemType('WORK_CONTRACT_INVALID'), status: 422, title: 'Work contract violates a rule' },
  { code: Schema.tag('WORK_CONTRACT_INVALID'), violations: Violations },
) {}
