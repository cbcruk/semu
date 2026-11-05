import { Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { problemType } from '../../../shared/problem/problem.ts'
import { UserProfile } from '../accounts/user.ts'
import { BusinessType, CompanyId, PlanSchema } from '../companies/company.ts'

/** 로그인 세션입니다. refresh token 한 계열(rotation family)이 세션 하나입니다. */
export interface SessionRecord {
  id: Id<'session'>
  userId: Id<'user'>
  /** 지금 access token이 묶인 회사입니다. 다룰 수 있는 회사가 없거나 대리인 범위면 비어 있습니다. */
  companyId?: Id<'company'>
  /** `AGENCY`면 지금 access token이 대리인 범위이고, refresh도 대리인 범위로 다시 발급합니다. 없으면 회사 범위입니다. */
  scope?: 'AGENCY'
  /** 지금 refresh token 비밀의 SHA-256입니다. */
  refreshSecretHash: string
  /** 이미 회전해 버린 refresh token 비밀의 해시입니다. 다시 오면 탈취로 보고 세션을 폐기합니다. */
  rotatedSecretHashes: ReadonlyArray<string>
  /** 마지막으로 발급한 access token의 SHA-256입니다. 회전·전환·로그아웃 때 이 해시로 폐기합니다. 원문은 저장하지 않습니다. */
  accessTokenHash?: string
  /** 회사가 없는 사용자가 회사를 등록할 때만 쓰는 토큰의 SHA-256입니다. 원문은 저장하지 않습니다. */
  onboardingTokenHash?: string
  /** onboarding token이 만료되는 시각입니다. 세션 만료보다 늦지 않습니다. */
  onboardingTokenExpiresAt?: string
  staySignedIn: boolean
  createdAt: string
  expiresAt: string
  revokedAt?: string
  revokedReason?: SessionRevocation
}

/** 세션을 폐기한 이유입니다. */
export type SessionRevocation =
  'SIGNED_OUT' | 'PASSWORD_CHANGED' | 'PASSWORD_RESET' | 'REFRESH_REUSED' | 'EXPIRED' | 'ACCOUNT_REMOVED'

/** 로그인 요청입니다. 현행 `POST /api/login/ {email, password, stay_signed_in}`입니다. */
export const SignInRequest = Schema.Struct({
  email: Schema.NonEmptyString,
  password: Schema.NonEmptyString,
  /** 참이면 refresh token이 14일, 아니면 1일 유지됩니다. */
  staySignedIn: Schema.optionalKey(Schema.Boolean),
  /** 처음 열 회사입니다. 없으면 마지막으로 쓴 회사, 그것도 없으면 가장 먼저 소속된 회사입니다. */
  companyId: Schema.optionalKey(CompanyId),
})

/** 회사 전환 요청입니다. */
export const SwitchCompanyRequest = Schema.Struct({ companyId: CompanyId })

/** 액세스 토큰 범위입니다. `COMPANY`는 회사 하나, `AGENCY`는 대리인의 담당 회사 전체(`/agency/*`만)입니다. */
export const TokenScopeSchema = Schema.Literals(['COMPANY', 'AGENCY'])

/** 회사 전환 목록의 한 줄입니다. */
export const CompanySummary = Schema.Struct({
  id: CompanyId,
  name: Schema.String,
  businessType: BusinessType,
  /** 이 회사에서 사용자가 행동하는 방식입니다. 세무 대리인으로 배정된 회사는 `AGENCY`입니다. */
  actorKind: Schema.Literals(['CLIENT', 'AGENCY']),
})

/**
 * 로그인·갱신·전환 응답입니다. refresh token은 본문에 넣지 않고 `HttpOnly` 쿠키로만 보냅니다.
 *
 * 다룰 회사가 없으면 `accessToken` 대신 `onboardingToken`을 주고, 클라이언트는 그 토큰으로 회사를 등록합니다.
 * 대리인 범위(`scope: AGENCY`)면 `company`가 없습니다.
 */
export const SessionGrant = Schema.Struct({
  accessToken: Schema.optionalKey(Schema.String),
  tokenType: Schema.optionalKey(Schema.Literal('Bearer')),
  /** `accessToken`의 범위입니다. `accessToken`이 있을 때만 있습니다. */
  scope: Schema.optionalKey(TokenScopeSchema),
  /** access token 수명(초)입니다. */
  expiresIn: Schema.optionalKey(Schema.Int),
  onboardingToken: Schema.optionalKey(Schema.String),
  user: UserProfile,
  company: Schema.optionalKey(Schema.Struct({ ...CompanySummary.fields, plans: Schema.Array(PlanSchema) })),
  companies: Schema.Array(CompanySummary),
})

export type SessionGrant = typeof SessionGrant.Type

/** refresh 쿠키가 없거나, 만료·폐기됐거나, 이미 쓴 토큰입니다. 다시 로그인합니다. */
export class SessionInvalid extends HttpApiError.Problem<SessionInvalid>()(
  'SessionInvalid',
  { type: problemType('SESSION_INVALID'), status: 401, title: 'Session is no longer valid' },
  { code: Schema.tag('SESSION_INVALID') },
) {}

/** 세무 대리인이 아닌 사용자가 대리인 범위 토큰을 요청했습니다. */
export class AgencyScopeNotAllowed extends HttpApiError.Problem<AgencyScopeNotAllowed>()(
  'AgencyScopeNotAllowed',
  { type: problemType('AGENCY_SCOPE_NOT_ALLOWED'), status: 403, title: 'Only agency staff can use the agency scope' },
  { code: Schema.tag('AGENCY_SCOPE_NOT_ALLOWED') },
) {}
