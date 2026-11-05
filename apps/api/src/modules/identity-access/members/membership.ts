import { Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import { IdSchema } from '../../../shared/ids/id-schema.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { problemType } from '../../../shared/problem/problem.ts'
import { UserId } from '../accounts/user.ts'

/**
 * 회사 안에서 사용자의 접근 수준입니다. 현행 `is_admin`입니다.
 *
 * - `ADMIN`: 모든 권한. 사용자 초대·권한 그룹 관리를 합니다
 * - `MEMBER`: 기본 권한과 부여받은 권한 그룹의 합집합
 */
export const MemberAccess = Schema.Literals(['ADMIN', 'MEMBER'])

export type MemberAccess = typeof MemberAccess.Type

/** 저장소가 가진 소속입니다. 사용자 한 명이 여러 회사에 소속될 수 있습니다. */
export interface Membership {
  id: Id<'membership'>
  companyId: Id<'company'>
  userId: Id<'user'>
  access: MemberAccess
  /** 부여한 권한 그룹입니다. `ADMIN`이면 비어 있습니다. */
  roleIds: ReadonlyArray<Id<'role'>>
  /** 회사를 등록한 소유자입니다. 현행 `isSystemAdmin`입니다. 회사당 한 명이고 내보내거나 강등할 수 없습니다. */
  isOwner: boolean
  joinedAt: string
  invitedBy?: Id<'user'>
  version: number
}

/** 회사 구성원 목록·상세 응답입니다. */
export const Member = Schema.Struct({
  userId: UserId,
  email: Schema.String,
  name: Schema.String,
  access: MemberAccess,
  roleIds: Schema.Array(IdSchema('role')),
  isOwner: Schema.Boolean,
  isMe: Schema.Boolean,
  joinedAt: Schema.String,
  version: Schema.Int,
})

export type Member = typeof Member.Type

/** 구성원의 접근 수준과 권한 그룹을 바꾸는 요청입니다. 현행 `PUT …/user/:id/permissions/ {is_admin, role_ids}`입니다. */
export const MemberAccessChange = Schema.Struct({
  access: MemberAccess,
  roleIds: Schema.Array(IdSchema('role')),
})

/** 요청한 사용자가 이 회사의 구성원이 아닙니다. */
export class MemberNotFound extends HttpApiError.Problem<MemberNotFound>()(
  'MemberNotFound',
  { type: problemType('MEMBER_NOT_FOUND'), status: 404, title: 'Member not found' },
  { code: Schema.tag('MEMBER_NOT_FOUND') },
) {}

/** 마지막 관리자를 강등하거나 내보내면 회사를 관리할 사람이 없어집니다. */
export class LastAdmin extends HttpApiError.Problem<LastAdmin>()(
  'LastAdmin',
  { type: problemType('LAST_ADMIN'), status: 409, title: 'Company needs at least one admin' },
  { code: Schema.tag('LAST_ADMIN') },
) {}

/** 회사 소유자는 강등하거나 내보낼 수 없습니다. */
export class OwnerImmutable extends HttpApiError.Problem<OwnerImmutable>()(
  'OwnerImmutable',
  { type: problemType('OWNER_IMMUTABLE'), status: 409, title: 'Company owner cannot be changed here' },
  { code: Schema.tag('OWNER_IMMUTABLE') },
) {}
