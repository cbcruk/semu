import { Schema } from 'effect'
import { IdSchema } from '../../../shared/ids/id-schema.ts'

/** 직원 ID입니다. 예: `emp_01J...` */
export const EmployeeId = IdSchema('employee')

/** 부서 ID입니다. */
export const DepartmentId = IdSchema('department')

/** 직위 ID입니다. */
export const PositionId = IdSchema('position')

/** 휴직 ID입니다. */
export const LeaveId = IdSchema('leave')

/** 근로계약 ID입니다. */
export const WorkContractId = IdSchema('workContract')

/** 급여계약 ID입니다. */
export const PayrollContractId = IdSchema('payrollContract')

/** 개인정보를 열람하는 사유입니다. 접근 기록에 남습니다. 한글은 퍼센트 인코딩(UTF-8)해서 보냅니다. */
export const AccessReasonHeaders = { 'x-access-reason': Schema.NonEmptyString }

/** 다른 사람의 변경을 덮어쓰지 않도록 보내는 버전입니다. 예: `"7"` */
export const IfMatchHeaders = { 'if-match': Schema.optionalKey(Schema.String) }

/** 422로 돌려주는 위반 목록입니다. */
export const Violations = Schema.Array(Schema.Struct({ field: Schema.String, code: Schema.String }))

/** 퍼센트 인코딩한 헤더 값을 풉니다. 풀 수 없으면 받은 그대로 씁니다. */
export function decodeHeaderText(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
