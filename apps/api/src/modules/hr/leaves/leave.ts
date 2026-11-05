import { Context, Layer, Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import { CalendarDate } from '../../../shared/time/date-schemas.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { problemType } from '../../../shared/problem/problem.ts'
import { EmployeeId, LeaveId, Violations } from '../shared/hr-schemas.ts'
import { makeTenantTable, TableFactory, type TenantTable } from '../../../shared/persistence/record-table.ts'
import type { LeaveReason } from './leave-rules.types.ts'

/** 휴직 사유입니다. 출산전후·육아·질병·기타입니다. */
export const LeaveReasonSchema = Schema.Literals(['MATERNITY', 'PARENTAL', 'ILLNESS', 'OTHER'])

/** 휴직 응답입니다. */
export const Leave = Schema.Struct({
  id: LeaveId,
  employeeId: EmployeeId,
  reason: LeaveReasonSchema,
  startDate: CalendarDate,
  endDate: CalendarDate,
  expectedReturnDate: CalendarDate,
  actualReturnDate: Schema.optionalKey(CalendarDate),
  /** 유급 휴직 수당(원)입니다. 무급이면 없습니다. */
  paidAllowance: Schema.optionalKey(Schema.Int),
  includeInServiceYears: Schema.Boolean,
  npsPaymentException: Schema.Boolean,
  nhisNoticeDeferral: Schema.Boolean,
  version: Schema.Int,
})

/** 휴직 응답의 타입입니다. */
export type Leave = typeof Leave.Type

/** 휴직 등록 본문입니다. */
export const CreateLeave = Schema.Struct({
  reason: LeaveReasonSchema,
  startDate: CalendarDate,
  endDate: CalendarDate,
  expectedReturnDate: Schema.optionalKey(CalendarDate),
  paid: Schema.optionalKey(Schema.Struct({ allowance: Schema.optionalKey(Schema.Int) })),
  includeInServiceYears: Schema.optionalKey(Schema.Boolean),
  npsPaymentException: Schema.optionalKey(Schema.Boolean),
  nhisNoticeDeferral: Schema.optionalKey(Schema.Boolean),
})

/** 저장하는 휴직입니다. */
export interface LeaveRecord {
  id: Id<'leave'>
  companyId: Id<'company'>
  employeeId: Id<'employee'>
  reason: LeaveReason
  startDate: string
  endDate: string
  expectedReturnDate: string
  actualReturnDate?: string | undefined
  paidAllowance?: number | undefined
  includeInServiceYears: boolean
  npsPaymentException: boolean
  nhisNoticeDeferral: boolean
  version: number
}

/** 휴직 저장소입니다. */
export class LeaveRepository extends Context.Service<LeaveRepository, TenantTable<LeaveRecord>>()(
  'semu/hr/LeaveRepository',
) {
  /** `hr_leaves` 표에 둡니다. 표가 비어 있으면 `seed`로 시작합니다. 저장 방식은 {@link TableFactory}가 정합니다. */
  static readonly layer = (seed: ReadonlyArray<LeaveRecord> = []) =>
    Layer.effect(LeaveRepository, makeTenantTable<LeaveRecord>('hr_leaves', seed))

  /** `seed`로 시작해 프로세스 메모리에 휴직을 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<LeaveRecord> = []) =>
    LeaveRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}

/** 휴직이 없거나 다른 직원의 휴직입니다. */
export class LeaveNotFound extends HttpApiError.Problem<LeaveNotFound>()(
  'LeaveNotFound',
  { type: problemType('LEAVE_NOT_FOUND'), status: 404, title: 'Leave not found' },
  { code: Schema.tag('LEAVE_NOT_FOUND') },
) {}

/** 휴직 입력이 업무 규칙을 어겼습니다. */
export class LeaveInvalid extends HttpApiError.Problem<LeaveInvalid>()(
  'LeaveInvalid',
  { type: problemType('LEAVE_INVALID'), status: 422, title: 'Leave input violates a rule' },
  { code: Schema.tag('LEAVE_INVALID'), violations: Violations },
) {}

/** 다른 휴직과 기간이 겹칩니다. */
export class LeaveOverlap extends HttpApiError.Problem<LeaveOverlap>()(
  'LeaveOverlap',
  { type: problemType('LEAVE_OVERLAP'), status: 409, title: 'Leave overlaps another leave' },
  { code: Schema.tag('LEAVE_OVERLAP'), overlappingLeaveId: LeaveId },
) {}
