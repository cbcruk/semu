import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { AccessReasonHeaders } from '../../../shared/personal-data/access-reason.ts'
import { VersionMismatch } from '../../../shared/problem/problem.ts'
import { Authentication } from '../../identity-access/authentication.ts'
import { EmployeeKindNotSupported, EmployeeNotFound } from '../employees/employee.ts'
import { ACCESS_ERRORS } from '../shared/hr-access.ts'
import { EmployeeId, FamilyMemberId, IfMatchHeaders } from '../shared/hr-schemas.ts'
import { FamilyMember, FamilyMemberInput, FamilyMemberInvalid, FamilyMemberNotFound } from './family-member.ts'

const withEtag = HttpApiSchema.WithHeaders(FamilyMember, { etag: Schema.String })

/**
 * 근로소득자의 가족(인적공제 대상자)입니다. 직원 아래에서 만들고, 만든 뒤에는 가족 ID로 다룹니다.
 *
 * 연말정산 대상 가족이 소득세 공제의 공제대상 가족 수가 되고, 건강보험 피부양자 여부가 피부양자 신고를 엽니다.
 */
export class FamilyMembersApi extends HttpApiGroup.make('hrFamilyMembers')
  .add(
    HttpApiEndpoint.get('list', '/employees/:id/family-members', {
      params: { id: EmployeeId },
      success: Schema.Struct({ items: Schema.Array(FamilyMember) }),
      error: [...ACCESS_ERRORS, EmployeeNotFound],
    }),
    HttpApiEndpoint.post('create', '/employees/:id/family-members', {
      params: { id: EmployeeId },
      payload: FamilyMemberInput,
      success: FamilyMember.pipe(HttpApiSchema.status(201)),
      error: [...ACCESS_ERRORS, EmployeeNotFound, EmployeeKindNotSupported, FamilyMemberInvalid],
    }),
    HttpApiEndpoint.get('get', '/family-members/:familyMemberId', {
      params: { familyMemberId: FamilyMemberId },
      success: withEtag,
      error: [...ACCESS_ERRORS, FamilyMemberNotFound],
    }),
    HttpApiEndpoint.put('update', '/family-members/:familyMemberId', {
      params: { familyMemberId: FamilyMemberId },
      headers: IfMatchHeaders,
      payload: FamilyMemberInput,
      success: withEtag,
      error: [...ACCESS_ERRORS, FamilyMemberNotFound, FamilyMemberInvalid, VersionMismatch],
    }),
    HttpApiEndpoint.delete('remove', '/family-members/:familyMemberId', {
      params: { familyMemberId: FamilyMemberId },
      success: HttpApiSchema.NoContent,
      error: [...ACCESS_ERRORS, FamilyMemberNotFound],
    }),
    HttpApiEndpoint.post('revealRegistrationNumber', '/family-members/:familyMemberId/registration-number::reveal', {
      params: { familyMemberId: FamilyMemberId },
      headers: AccessReasonHeaders,
      success: Schema.Struct({ registrationNumber: Schema.String }),
      error: [...ACCESS_ERRORS, FamilyMemberNotFound],
    }),
  )
  .middleware(Authentication) {}
