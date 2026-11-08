import { Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import { CalendarDate } from '../../../shared/time/date-schemas.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { problemType } from '../../../shared/problem/problem.ts'
import { DepartmentId, EmployeeId, PositionId, Violations } from '../shared/hr-schemas.ts'
import type { IdentityNumberType } from '../shared/identity-number.types.ts'
import type { EmployeeKind } from './employee-kind.types.ts'

/** 직원 종류입니다. 근로소득·일용·사업소득·기타소득자를 한 집합체로 다룹니다. */
export const EmployeeKindSchema = Schema.Literals(['WAGE', 'DAILY', 'BUSINESS', 'OTHER'])

/** 기준일에 날짜로 계산한 직원 상태입니다. */
export const EmployeeStatusSchema = Schema.Literals(['PRE_JOINED', 'JOINED', 'LEAVE', 'RESIGNED'])

/** 직원 목록 ▲ 아이콘 뒤의 경고입니다. */
export const EmployeeWarningSchema = Schema.Literals([
  'MISSING_REGISTRATION_NUMBER',
  'CONTRACT_EXPIRING_SOON',
  'CONTRACT_EXPIRED',
  'INDEFINITE_CONVERSION_TARGET',
])

/** 퇴사 정보입니다. `:resign`으로 정합니다. */
export const Resignation = Schema.Struct({
  leaveDate: CalendarDate,
  /** 고용보험 상실 사유 코드입니다. 예: `11` */
  leavingReasonCode: Schema.String,
  /** 상세 사유 코드입니다. 예: `11-1` */
  leavingDetailReasonCode: Schema.optionalKey(Schema.String),
})

/** 직원 응답입니다. 주민번호는 가린 값만 담고, 원문은 `:reveal`로 따로 받습니다. */
export const Employee = Schema.Struct({
  id: EmployeeId,
  kind: EmployeeKindSchema,
  name: Schema.String,
  identityType: Schema.optionalKey(Schema.Literals(['RRN', 'PASSPORT'])),
  /** 예: `900101-1******` */
  registrationNumberMasked: Schema.optionalKey(Schema.String),
  birthDate: Schema.optionalKey(CalendarDate),
  joinDate: CalendarDate,
  isRejoin: Schema.Boolean,
  departmentId: Schema.optionalKey(DepartmentId),
  positionId: Schema.optionalKey(PositionId),
  email: Schema.optionalKey(Schema.String),
  phone: Schema.optionalKey(Schema.String),
  isForeigner: Schema.Boolean,
  nationalityCode: Schema.optionalKey(Schema.String),
  visaCode: Schema.optionalKey(Schema.String),
  resignation: Schema.optionalKey(Resignation),
  status: EmployeeStatusSchema,
  warnings: Schema.Array(EmployeeWarningSchema),
  version: Schema.Int,
  createdAt: Schema.String,
  updatedAt: Schema.String,
})

/** 직원 응답의 타입입니다. */
export type Employee = typeof Employee.Type

const editableFields = {
  name: Schema.NonEmptyString,
  /** 주민등록번호(내국인) 또는 여권번호(외국인)입니다. 하이픈은 있어도 됩니다. */
  registrationNumber: Schema.optionalKey(Schema.String),
  identityType: Schema.optionalKey(Schema.Literals(['RRN', 'PASSPORT'])),
  birthDate: Schema.optionalKey(CalendarDate),
  joinDate: CalendarDate,
  departmentId: Schema.optionalKey(DepartmentId),
  positionId: Schema.optionalKey(PositionId),
  email: Schema.optionalKey(Schema.String),
  phone: Schema.optionalKey(Schema.String),
  isForeigner: Schema.optionalKey(Schema.Boolean),
  nationalityCode: Schema.optionalKey(Schema.String),
  visaCode: Schema.optionalKey(Schema.String),
}

/** 직원 등록 본문입니다. */
export const CreateEmployee = Schema.Struct({
  kind: EmployeeKindSchema,
  isRejoin: Schema.optionalKey(Schema.Boolean),
  ...editableFields,
})

/** 직원 수정 본문입니다. 보낸 필드만 바꿉니다. */
export const UpdateEmployee = Schema.Struct({
  name: Schema.optionalKey(editableFields.name),
  registrationNumber: editableFields.registrationNumber,
  identityType: editableFields.identityType,
  birthDate: editableFields.birthDate,
  joinDate: Schema.optionalKey(CalendarDate),
  departmentId: Schema.optionalKey(Schema.NullOr(DepartmentId)),
  positionId: Schema.optionalKey(Schema.NullOr(PositionId)),
  email: editableFields.email,
  phone: editableFields.phone,
  isForeigner: editableFields.isForeigner,
  nationalityCode: editableFields.nationalityCode,
  visaCode: editableFields.visaCode,
})

/** 저장하는 직원입니다. 주민번호는 암호문·HMAC 해시·가린 값으로 나눠 둡니다. */
export interface EmployeeRecord {
  id: Id<'employee'>
  companyId: Id<'company'>
  kind: EmployeeKind
  name: string
  identityType?: IdentityNumberType | undefined
  registrationNumberEncrypted?: string | undefined
  registrationNumberHash?: string | undefined
  registrationNumberMasked?: string | undefined
  birthDate?: string | undefined
  joinDate: string
  isRejoin: boolean
  departmentId?: Id<'department'> | undefined
  positionId?: Id<'position'> | undefined
  email?: string | undefined
  phone?: string | undefined
  isForeigner: boolean
  nationalityCode?: string | undefined
  visaCode?: string | undefined
  resignation?: typeof Resignation.Type | undefined
  version: number
  createdAt: string
  updatedAt: string
}

/** 직원이 없거나 다른 회사의 직원입니다. */
export class EmployeeNotFound extends HttpApiError.Problem<EmployeeNotFound>()(
  'EmployeeNotFound',
  { type: problemType('EMPLOYEE_NOT_FOUND'), status: 404, title: 'Employee not found' },
  { code: Schema.tag('EMPLOYEE_NOT_FOUND') },
) {}

/** 같은 종류에 같은 주민번호의 직원이 이미 있습니다. 퇴사자라면 `isRejoin`으로 다시 등록합니다. */
export class EmployeeDuplicate extends HttpApiError.Problem<EmployeeDuplicate>()(
  'EmployeeDuplicate',
  { type: problemType('EMPLOYEE_DUPLICATE'), status: 409, title: 'Employee with this registration number exists' },
  { code: Schema.tag('EMPLOYEE_DUPLICATE'), duplicateEmployeeId: EmployeeId },
) {}

/** 직원 입력이 업무 규칙을 어겼습니다. */
export class EmployeeInvalid extends HttpApiError.Problem<EmployeeInvalid>()(
  'EmployeeInvalid',
  { type: problemType('EMPLOYEE_INVALID'), status: 422, title: 'Employee input violates a rule' },
  { code: Schema.tag('EMPLOYEE_INVALID'), violations: Violations },
) {}

/** 퇴직금 정산이 끝난 직원은 지우거나 퇴사를 취소할 수 없습니다. */
export class RetirementCompleted extends HttpApiError.Problem<RetirementCompleted>()(
  'RetirementCompleted',
  { type: problemType('RETIREMENT_COMPLETED'), status: 409, title: 'Severance settlement is completed' },
  { code: Schema.tag('RETIREMENT_COMPLETED') },
) {}

/** 퇴사 입력을 받을 수 없습니다. */
export class ResignationRejected extends HttpApiError.Problem<ResignationRejected>()(
  'ResignationRejected',
  { type: problemType('RESIGNATION_REJECTED'), status: 422, title: 'Resignation violates a rule' },
  {
    code: Schema.tag('RESIGNATION_REJECTED'),
    reason: Schema.Literals([
      'LEAVE_DATE_BEFORE_JOIN',
      'LEAVE_DATE_BEFORE_INTERIM',
      'LEAVING_REASON_INVALID',
      'NOT_RESIGNED',
    ]),
  },
) {}

/** 이 리소스는 근로소득자(`WAGE`)에게만 둡니다. 급여계약·소득세 공제가 해당합니다. */
export class EmployeeKindNotSupported extends HttpApiError.Problem<EmployeeKindNotSupported>()(
  'EmployeeKindNotSupported',
  { type: problemType('EMPLOYEE_KIND_NOT_SUPPORTED'), status: 422, title: 'Employee kind is not supported here' },
  { code: Schema.tag('EMPLOYEE_KIND_NOT_SUPPORTED'), kind: EmployeeKindSchema },
) {}
