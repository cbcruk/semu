/** Income type of a person the company pays, stored in `employees.kind`. */
export type EmployeeKind = 'wage-salary' | 'daily' | 'business' | 'other'

/** Wire value that names an employee kind in e-sign and certificate payloads (the legacy Django model name). */
export type EmploymentType = 'wageemployee' | 'dailyemployee' | 'businessemployee' | 'otheremployee'

/** Error codes specific to the HR domain, sent in the `code` field. */
export type HrErrorCode =
  | 'DUPLICATE_EMPLOYEE'
  | 'RETIREMENT_COMPLETED'
  | 'LEAVE_DATE_BEFORE_INTERIM'
  | 'LEAVE_OVERLAP'
  | 'DEPARTMENT_IN_USE'
  | 'POSITION_IN_USE'
  | 'SEAL_LIMIT_EXCEEDED'
  | 'SIGNING_TOKEN_INVALID'
  | 'SIGNING_CLOSED'
  | 'SIGNER_SESSION_REQUIRED'
  | 'SIGNER_SESSION_INVALID'
  | 'IDENTITY_VERIFICATION_FAILED'
  | 'IDENTITY_VERIFICATION_LOCKED'

/** Who triggered a change, for audit columns. */
export interface HrActor {
  userId: string
}
