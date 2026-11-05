import { Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import { IdSchema } from '../../../shared/ids/id-schema.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { problemType } from '../../../shared/problem/problem.ts'

/** 권한 그룹 ID입니다. 예: `rol_01J...` */
export const RoleId = IdSchema('role')

/** `resource:action` 형식의 권한 문자열입니다. 카탈로그에 있는지는 서비스가 검사합니다. */
export const PermissionString = Schema.String.check(Schema.isPattern(/^[a-z][a-z-]*:([a-z][a-z-]*|\*)$/))

/**
 * 권한 그룹(역할)입니다. 회사가 만든 권한 묶음 프리셋이고, 구성원은 여러 그룹을 받아 권한의 합집합을 가집니다.
 *
 * 현행은 3뎁스 메뉴 ID 집합이었습니다. 재설계는 권한 문자열 집합이고, 메뉴는 클라이언트가 권한으로 그립니다.
 */
export const Role = Schema.Struct({
  id: RoleId,
  name: Schema.String,
  permissions: Schema.Array(Schema.String),
  /** 템플릿에서 만들었으면 그 코드입니다. */
  templateCode: Schema.optionalKey(Schema.String),
  memberCount: Schema.Int,
  createdAt: Schema.String,
  version: Schema.Int,
})

export type Role = typeof Role.Type

/** 저장소가 가진 권한 그룹입니다. 구성원 수는 조회할 때 셉니다. */
export interface RoleRecord extends Omit<Role, 'memberCount'> {
  companyId: Id<'company'>
}

/** 권한 그룹 생성·수정 요청입니다. */
export const RoleInput = Schema.Struct({
  name: Schema.NonEmptyString.check(Schema.isMaxLength(30)),
  permissions: Schema.Array(PermissionString),
  templateCode: Schema.optionalKey(Schema.String),
})

export type RoleInput = typeof RoleInput.Type

/** 권한 그룹 템플릿 응답입니다. */
export const RoleTemplateSchema = Schema.Struct({
  code: Schema.String,
  name: Schema.String,
  permissions: Schema.Array(Schema.String),
})

/** 권한 카탈로그 항목입니다. 권한 그룹 편집 화면이 영역별로 묶어 그립니다. */
export const PermissionEntry = Schema.Struct({
  permission: Schema.String,
  area: Schema.String,
  /** 이 권한을 쓰는 화면에 필요한 플랜입니다. 하나라도 있으면 됩니다. */
  requiredPlans: Schema.Array(Schema.Literals(['TAXATION', 'PAYROLL'])),
})

/** 요청한 권한 그룹이 이 회사에 없습니다. */
export class RoleNotFound extends HttpApiError.Problem<RoleNotFound>()(
  'RoleNotFound',
  { type: problemType('ROLE_NOT_FOUND'), status: 404, title: 'Role not found' },
  { code: Schema.tag('ROLE_NOT_FOUND') },
) {}

/** 권한 그룹으로 줄 수 없는 권한이 들어 있습니다. 관리자 전용 권한과 카탈로그에 없는 권한입니다. */
export class PermissionNotGrantable extends HttpApiError.Problem<PermissionNotGrantable>()(
  'PermissionNotGrantable',
  { type: problemType('PERMISSION_NOT_GRANTABLE'), status: 422, title: 'Permission cannot be granted by a role' },
  { code: Schema.tag('PERMISSION_NOT_GRANTABLE'), permissions: Schema.Array(Schema.String) },
) {}

/** 같은 이름의 권한 그룹이 이미 있습니다. */
export class RoleNameTaken extends HttpApiError.Problem<RoleNameTaken>()(
  'RoleNameTaken',
  { type: problemType('ROLE_NAME_TAKEN'), status: 409, title: 'Role name is already used' },
  { code: Schema.tag('ROLE_NAME_TAKEN') },
) {}
