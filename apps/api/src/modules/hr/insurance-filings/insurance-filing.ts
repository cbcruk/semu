import { Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import { problemType } from '../../../shared/problem/problem.ts'
import { CalendarDate } from '../../../shared/time/date-schemas.ts'
import { FamilyRelationSchema } from '../family/family-member.ts'
import { EmployeeId, InsuranceFilingId } from '../shared/hr-schemas.ts'

const Won = Schema.Int

/** 신고 종류입니다. */
export const InsuranceFilingKindSchema = Schema.Literals([
  'ACQUISITION',
  'LOSS',
  'LEAVE',
  'RETURN',
  'DEPENDANT',
  'REMUNERATION_CHANGE',
])

/** 신고 처리 상태입니다. */
export const InsuranceFilingStatusSchema = Schema.Literals(['PENDING', 'DONE', 'FAILED', 'WITHDRAWN'])

const common = {
  id: InsuranceFilingId,
  employeeId: EmployeeId,
  /** 목록에서 대리인이 알아보는 직원 이름입니다. 지운 직원의 신고(모두 닫힘)면 빈 문자열입니다. */
  employeeName: Schema.String,
  source: Schema.Struct({
    type: Schema.Literals(['EMPLOYEE', 'LEAVE', 'FAMILY_MEMBER', 'PAYROLL_CONTRACT']),
    id: Schema.String,
  }),
  status: InsuranceFilingStatusSchema,
  requestedAt: Schema.String,
  processedAt: Schema.optionalKey(Schema.String),
  resultMessage: Schema.optionalKey(Schema.String),
}

/** 4대보험 신고 응답입니다. `kind`마다 `payload` 모양이 다릅니다. */
export const InsuranceFilingView = Schema.Union([
  Schema.Struct({
    ...common,
    kind: Schema.Literal('ACQUISITION'),
    payload: Schema.Struct({ acquisitionDate: CalendarDate }),
  }),
  Schema.Struct({
    ...common,
    kind: Schema.Literal('LOSS'),
    payload: Schema.Struct({
      leaveDate: CalendarDate,
      lossDate: CalendarDate,
      leavingReasonCode: Schema.String,
      leavingDetailReasonCode: Schema.optionalKey(Schema.String),
    }),
  }),
  Schema.Struct({
    ...common,
    kind: Schema.Literal('LEAVE'),
    payload: Schema.Struct({
      startDate: CalendarDate,
      endDate: CalendarDate,
      npsPaymentException: Schema.Boolean,
      nhisNoticeDeferral: Schema.Boolean,
    }),
  }),
  Schema.Struct({
    ...common,
    kind: Schema.Literal('RETURN'),
    payload: Schema.Struct({ leaveStartDate: CalendarDate, returnDate: CalendarDate }),
  }),
  Schema.Struct({
    ...common,
    kind: Schema.Literal('DEPENDANT'),
    payload: Schema.Struct({
      familyMemberId: Schema.String,
      change: Schema.Literals(['ADD', 'REMOVE']),
      name: Schema.String,
      relation: FamilyRelationSchema,
      birthDate: CalendarDate,
    }),
  }),
  Schema.Struct({
    ...common,
    kind: Schema.Literal('REMUNERATION_CHANGE'),
    payload: Schema.Struct({
      effectiveFrom: CalendarDate,
      wageType: Schema.Literals(['MONTHLY', 'DAILY', 'HOURLY']),
      amount: Won,
    }),
  }),
])

/** {@link InsuranceFilingView}의 타입입니다. */
export type InsuranceFilingView = typeof InsuranceFilingView.Type

/** 4대보험 신고가 없거나 다른 회사의 신고입니다. */
export class InsuranceFilingNotFound extends HttpApiError.Problem<InsuranceFilingNotFound>()(
  'InsuranceFilingNotFound',
  { type: problemType('INSURANCE_FILING_NOT_FOUND'), status: 404, title: 'Insurance filing not found' },
  { code: Schema.tag('INSURANCE_FILING_NOT_FOUND') },
) {}

/** 닫힌 신고(`DONE`·`WITHDRAWN`)는 처리할 수 없습니다. `currentStatus`는 지금 상태입니다. */
export class InsuranceFilingTransitionInvalid extends HttpApiError.Problem<InsuranceFilingTransitionInvalid>()(
  'InsuranceFilingTransitionInvalid',
  {
    type: problemType('INSURANCE_FILING_TRANSITION_INVALID'),
    status: 409,
    title: 'Insurance filing is already closed',
  },
  { code: Schema.tag('INSURANCE_FILING_TRANSITION_INVALID'), currentStatus: InsuranceFilingStatusSchema },
) {}
