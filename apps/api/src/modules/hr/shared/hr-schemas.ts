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

/** 다른 사람의 변경을 덮어쓰지 않도록 보내는 버전입니다. 예: `"7"` */
export const IfMatchHeaders = { 'if-match': Schema.optionalKey(Schema.String) }

/** 422로 돌려주는 위반 목록입니다. */
export const Violations = Schema.Array(Schema.Struct({ field: Schema.String, code: Schema.String }))

/** 4대보험 신고 ID입니다. */
export const InsuranceFilingId = IdSchema('insuranceFiling')

/** 인적공제 대상자(가족) ID입니다. */
export const FamilyMemberId = IdSchema('familyMember')

/** 문서 보관함 문서 ID입니다. */
export const EmployeeDocumentId = IdSchema('document')

/** 파일 ID입니다. 파일 저장소는 아직 없습니다. */
export const FileId = IdSchema('file')

/** 전자서명 요청 ID입니다. */
export const EsignRequestId = IdSchema('esignRequest')
