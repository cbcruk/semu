import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { CalendarDate } from '../../../shared/time/date-schemas.ts'
import { Page, PageQueryFields } from '../../../shared/http/pagination.ts'
import { VersionMismatch } from '../../../shared/problem/problem.ts'
import { Authentication } from '../../identity-access/authentication.ts'
import { ACCESS_ERRORS } from '../shared/hr-access.ts'
import { AccessReasonHeaders, EmployeeId, IfMatchHeaders } from '../shared/hr-schemas.ts'
import {
  CreateEmployee,
  Employee,
  EmployeeDuplicate,
  EmployeeInvalid,
  EmployeeKindSchema,
  EmployeeNotFound,
  EmployeeStatusSchema,
  Resignation,
  ResignationRejected,
  RetirementCompleted,
  UpdateEmployee,
} from './employee.ts'

const params = { id: EmployeeId }
const withEtag = HttpApiSchema.WithHeaders(Employee, { etag: Schema.String })

/**
 * 직원입니다. 근로·일용·사업소득·기타소득자를 `kind` 하나로 구분합니다.
 *
 * 상태(`status`)와 경고(`warnings`)는 기준일(`asOf`, 기본 오늘)로 계산합니다. 퇴사는 `:resign` 커맨드입니다.
 */
export class EmployeesApi extends HttpApiGroup.make('hrEmployees')
  .add(
    HttpApiEndpoint.get('list', '/employees', {
      query: {
        asOf: Schema.optionalKey(CalendarDate),
        kind: Schema.optionalKey(EmployeeKindSchema),
        status: Schema.optionalKey(EmployeeStatusSchema),
        ...PageQueryFields,
      },
      success: Page(Employee),
      error: ACCESS_ERRORS,
    }),
    HttpApiEndpoint.post('create', '/employees', {
      payload: CreateEmployee,
      success: Employee.pipe(HttpApiSchema.status(201)),
      error: [...ACCESS_ERRORS, EmployeeInvalid, EmployeeDuplicate],
    }),
    HttpApiEndpoint.get('get', '/employees/:id', {
      params,
      success: withEtag,
      error: [...ACCESS_ERRORS, EmployeeNotFound],
    }),
    HttpApiEndpoint.patch('update', '/employees/:id', {
      params,
      headers: IfMatchHeaders,
      payload: UpdateEmployee,
      success: withEtag,
      error: [...ACCESS_ERRORS, EmployeeNotFound, EmployeeInvalid, EmployeeDuplicate, VersionMismatch],
    }),
    HttpApiEndpoint.delete('remove', '/employees/:id', {
      params,
      success: HttpApiSchema.NoContent,
      error: [...ACCESS_ERRORS, EmployeeNotFound, RetirementCompleted],
    }),
    HttpApiEndpoint.post('revealRegistrationNumber', '/employees/:id/registration-number::reveal', {
      params,
      headers: AccessReasonHeaders,
      success: Schema.Struct({ registrationNumber: Schema.String }),
      error: [...ACCESS_ERRORS, EmployeeNotFound],
    }),
    HttpApiEndpoint.post('resign', '/employees/:id::resign', {
      params,
      headers: IfMatchHeaders,
      payload: Resignation,
      success: withEtag,
      error: [...ACCESS_ERRORS, EmployeeNotFound, ResignationRejected, RetirementCompleted, VersionMismatch],
    }),
    HttpApiEndpoint.post('cancelResignation', '/employees/:id::cancel-resignation', {
      params,
      headers: IfMatchHeaders,
      success: withEtag,
      error: [...ACCESS_ERRORS, EmployeeNotFound, ResignationRejected, RetirementCompleted, VersionMismatch],
    }),
  )
  .middleware(Authentication) {}
