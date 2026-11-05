import { Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import { IdSchema } from '../../../shared/ids/id-schema.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { problemType } from '../../../shared/problem/problem.ts'

/** 사용자 ID입니다. 예: `usr_01J...` */
export const UserId = IdSchema('user')

/**
 * 사용자 종류입니다. 현행 숫자 `userType`을 대신합니다.
 *
 * - `CLIENT`: 고객사 사용자(현행 0). 데모 계정(현행 99)도 여기에 들고 `isDemo`로 구분합니다
 * - `AGENCY_STAFF`: 세무 대리인 담당자(현행 1)
 * - `AGENCY_MANAGER`: 세무 대리인 팀장(현행 2). 팀원에게 배정된 회사도 다룹니다
 *
 * 운영자(3)·봇(4)·노무 대리인(51)은 이 API의 사용자가 아닙니다.
 */
export const UserKind = Schema.Literals(['CLIENT', 'AGENCY_STAFF', 'AGENCY_MANAGER'])

export type UserKind = typeof UserKind.Type

/** 응답에 내보내는 사용자 정보입니다. */
export const UserProfile = Schema.Struct({
  id: UserId,
  /** 로그인 ID입니다. 바꿀 수 없습니다. */
  email: Schema.String,
  name: Schema.String,
  kind: UserKind,
  isDemo: Schema.Boolean,
})

export type UserProfile = typeof UserProfile.Type

/** 저장소가 가진 사용자입니다. 비밀번호 해시와 잠금 상태는 응답에 나가지 않습니다. */
export interface UserRecord extends UserProfile {
  passwordHash: string
  status: 'ACTIVE' | 'DEACTIVATED'
  /** 팀장의 사용자 ID입니다. 대리인 담당자만 있습니다. */
  managerId?: Id<'user'>
  /** 연속으로 틀린 로그인 횟수입니다. 성공하면 0이 됩니다. */
  failedSignInCount: number
  /** 마지막으로 쓴 회사입니다. 다음 로그인의 기본 회사입니다. */
  lastCompanyId?: Id<'company'>
  createdAt: string
}

/** 응답에 넣을 사용자 정보만 고릅니다. */
export function toUserProfile(user: UserRecord): UserProfile {
  return { id: user.id, email: user.email, name: user.name, kind: user.kind, isDemo: user.isDemo }
}

/** 로그인 ID를 비교·저장하는 형태로 바꿉니다. 이메일은 대소문자를 구분하지 않습니다. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** 이메일이나 비밀번호가 틀렸습니다. 계정이 있는지는 드러내지 않습니다. */
export class InvalidCredentials extends HttpApiError.Problem<InvalidCredentials>()(
  'InvalidCredentials',
  { type: problemType('INVALID_CREDENTIALS'), status: 401, title: 'Email or password is incorrect' },
  { code: Schema.tag('INVALID_CREDENTIALS') },
) {}

/** 로그인을 연속으로 틀려 계정이 잠겼습니다. 비밀번호를 재설정하면 풀립니다. */
export class AccountLocked extends HttpApiError.Problem<AccountLocked>()(
  'AccountLocked',
  { type: problemType('ACCOUNT_LOCKED'), status: 423, title: 'Account is locked' },
  { code: Schema.tag('ACCOUNT_LOCKED') },
) {}

/** 새 비밀번호가 정책을 어겼습니다. `violations[].code`가 사유입니다. */
export class PasswordPolicyViolated extends HttpApiError.Problem<PasswordPolicyViolated>()(
  'PasswordPolicyViolated',
  { type: problemType('PASSWORD_POLICY_VIOLATED'), status: 422, title: 'Password does not meet the policy' },
  {
    code: Schema.tag('PASSWORD_POLICY_VIOLATED'),
    violations: Schema.Array(Schema.Struct({ field: Schema.String, code: Schema.String })),
  },
) {}

/** 데모 계정은 비밀번호를 바꾸거나 데이터를 쓸 수 없습니다. */
export class DemoReadOnly extends HttpApiError.Problem<DemoReadOnly>()(
  'DemoReadOnly',
  { type: problemType('DEMO_READ_ONLY'), status: 403, title: 'Demo accounts are read-only' },
  { code: Schema.tag('DEMO_READ_ONLY') },
) {}
