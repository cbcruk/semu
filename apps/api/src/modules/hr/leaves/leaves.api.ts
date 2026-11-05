import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { VersionMismatch } from '../../../shared/problem/problem.ts'
import { Authentication } from '../../identity-access/authentication.ts'
import { EmployeeNotFound } from '../employees/employee.ts'
import { ACCESS_ERRORS } from '../shared/hr-access.ts'
import { CalendarDate, EmployeeId, IfMatchHeaders, LeaveId } from '../shared/hr-schemas.ts'
import { CreateLeave, Leave, LeaveInvalid, LeaveNotFound, LeaveOverlap } from './leave.ts'

/** 직원의 휴직 요약입니다. */
const LeaveSummary = Schema.Struct({
  isOnLeave: Schema.Boolean,
  currentLeaveId: Schema.optionalKey(Schema.String),
  upcomingLeaveId: Schema.optionalKey(Schema.String),
  totalLeaveDays: Schema.Int,
  parentalLeaveDays: Schema.Int,
  parentalLeaveRemainingDays: Schema.Int,
})

/** 휴직입니다. 직원 아래에서 만들고, 만든 뒤에는 휴직 ID로 다룹니다. 복직은 `:return` 커맨드입니다. */
export class LeavesApi extends HttpApiGroup.make('hrLeaves')
  .add(
    HttpApiEndpoint.get('list', '/employees/:id/leaves', {
      params: { id: EmployeeId },
      success: Schema.Struct({ items: Schema.Array(Leave), summary: LeaveSummary }),
      error: [...ACCESS_ERRORS, EmployeeNotFound],
    }),
    HttpApiEndpoint.post('create', '/employees/:id/leaves', {
      params: { id: EmployeeId },
      payload: CreateLeave,
      success: Leave.pipe(HttpApiSchema.status(201)),
      error: [...ACCESS_ERRORS, EmployeeNotFound, LeaveInvalid, LeaveOverlap],
    }),
    HttpApiEndpoint.post('returnFromLeave', '/leaves/:leaveId::return', {
      params: { leaveId: LeaveId },
      headers: IfMatchHeaders,
      payload: Schema.Struct({ actualReturnDate: CalendarDate }),
      success: HttpApiSchema.WithHeaders(Leave, { etag: Schema.String }),
      error: [...ACCESS_ERRORS, LeaveNotFound, LeaveInvalid, VersionMismatch],
    }),
    HttpApiEndpoint.delete('remove', '/leaves/:leaveId', {
      params: { leaveId: LeaveId },
      success: HttpApiSchema.NoContent,
      error: [...ACCESS_ERRORS, LeaveNotFound],
    }),
  )
  .middleware(Authentication) {}
