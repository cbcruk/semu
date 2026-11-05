import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import {
  EntitlementRequired,
  PermissionDenied,
  TermsReagreementRequired,
  VersionMismatch,
} from '../../../shared/problem/problem.ts'
import { Authentication } from '../authentication.ts'
import {
  PermissionEntry,
  PermissionNotGrantable,
  Role,
  RoleId,
  RoleInput,
  RoleNameTaken,
  RoleNotFound,
  RoleTemplateSchema,
} from './role.ts'

const denied = [PermissionDenied, EntitlementRequired, TermsReagreementRequired]
const params = { roleId: RoleId }
const withEtag = HttpApiSchema.WithHeaders(Role, { etag: Schema.String })

/**
 * 권한 그룹, 그룹 템플릿, 그룹에 넣을 수 있는 권한 목록입니다. 현행 `/api/perm/*`입니다.
 *
 * 그룹 만들기·고치기·지우기는 관리자 전용 권한(`role:create` 등)이라 관리자와 세무 대리인만 합니다.
 */
export class RolesApi extends HttpApiGroup.make('roles')
  .add(
    HttpApiEndpoint.get('list', '/roles', {
      success: Schema.Struct({ items: Schema.Array(Role) }),
      error: denied,
    }),
    HttpApiEndpoint.post('create', '/roles', {
      payload: RoleInput,
      success: Role.pipe(HttpApiSchema.status(201)),
      error: [...denied, PermissionNotGrantable, RoleNameTaken],
    }),
    HttpApiEndpoint.get('get', '/roles/:roleId', {
      params,
      success: withEtag,
      error: [...denied, RoleNotFound],
    }),
    HttpApiEndpoint.put('update', '/roles/:roleId', {
      params,
      headers: { 'if-match': Schema.optionalKey(Schema.String) },
      payload: RoleInput,
      success: withEtag,
      error: [...denied, RoleNotFound, PermissionNotGrantable, RoleNameTaken, VersionMismatch],
    }),
    HttpApiEndpoint.delete('remove', '/roles/:roleId', {
      params,
      success: HttpApiSchema.NoContent,
      error: [...denied, RoleNotFound],
    }),
    HttpApiEndpoint.get('templates', '/role-templates', {
      success: Schema.Struct({ items: Schema.Array(RoleTemplateSchema) }),
      error: denied,
    }),
    HttpApiEndpoint.get('permissions', '/permissions', {
      success: Schema.Struct({ items: Schema.Array(PermissionEntry) }),
      error: denied,
    }),
  )
  .middleware(Authentication) {}
