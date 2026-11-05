import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { Page, PageQueryFields } from '../../../shared/http/pagination.ts'
import {
  EntitlementRequired,
  PermissionDenied,
  TermsReagreementRequired,
  VersionMismatch,
} from '../../../shared/problem/problem.ts'
import { UserId } from '../accounts/user.ts'
import { Authentication } from '../authentication.ts'
import { RoleNotFound } from '../roles/role.ts'
import { LastAdmin, Member, MemberAccessChange, MemberNotFound, OwnerImmutable } from './membership.ts'

const denied = [PermissionDenied, EntitlementRequired, TermsReagreementRequired]
const params = { userId: UserId }

/** 지금 회사의 구성원(사용자)입니다. 현행 `/api/v1/company/:id/user/`입니다. */
export class MembersApi extends HttpApiGroup.make('members')
  .add(
    HttpApiEndpoint.get('list', '/users', {
      query: Schema.Struct(PageQueryFields),
      success: Page(Member),
      error: denied,
    }),
    HttpApiEndpoint.get('get', '/users/:userId', {
      params,
      success: HttpApiSchema.WithHeaders(Member, { etag: Schema.String }),
      error: [...denied, MemberNotFound],
    }),
    HttpApiEndpoint.post('changeAccess', '/users/:userId::change-access', {
      params,
      headers: { 'if-match': Schema.optionalKey(Schema.String) },
      payload: MemberAccessChange,
      success: HttpApiSchema.WithHeaders(Member, { etag: Schema.String }),
      error: [...denied, MemberNotFound, RoleNotFound, OwnerImmutable, LastAdmin, VersionMismatch],
    }),
    HttpApiEndpoint.delete('remove', '/users/:userId', {
      params,
      success: HttpApiSchema.NoContent,
      error: [...denied, MemberNotFound, OwnerImmutable, LastAdmin],
    }),
  )
  .middleware(Authentication) {}
