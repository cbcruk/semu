import { Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import { IdSchema } from '../../../shared/ids/id-schema.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { problemType } from '../../../shared/problem/problem.ts'
import { MemberAccess } from '../members/membership.ts'
import { TermId } from '../terms/term.ts'
import type { StoredInvitationStatus } from './invitation-status.types.ts'

/** 초대 ID입니다. 예: `inv_01J...` */
export const InvitationId = IdSchema('invitation')

/** 초대 상태입니다. */
export const InvitationStatusSchema = Schema.Literals(['PENDING', 'ACCEPTED', 'CANCELED', 'EXPIRED'])

/** 회사 사용자 초대입니다. 링크 토큰은 만들 때 메일로만 보내고 저장소에는 해시만 둡니다. */
export const Invitation = Schema.Struct({
  id: InvitationId,
  email: Schema.String,
  name: Schema.optionalKey(Schema.String),
  access: MemberAccess,
  roleIds: Schema.Array(IdSchema('role')),
  status: InvitationStatusSchema,
  /** 만료까지 남은 날(올림)입니다. `PENDING`일 때만 있습니다. */
  remainingDays: Schema.optionalKey(Schema.Int),
  invitedBy: IdSchema('user'),
  createdAt: Schema.String,
  expiresAt: Schema.String,
  allowedActions: Schema.Array(Schema.Literals(['CANCEL', 'REINVITE'])),
})

export type Invitation = typeof Invitation.Type

/** 저장소가 가진 초대입니다. */
export interface InvitationRecord {
  id: Id<'invitation'>
  companyId: Id<'company'>
  email: string
  name?: string
  access: 'ADMIN' | 'MEMBER'
  roleIds: ReadonlyArray<Id<'role'>>
  status: StoredInvitationStatus
  tokenHash: string
  invitedBy: Id<'user'>
  createdAt: string
  expiresAt: string
  acceptedAt?: string
  acceptedUserId?: Id<'user'>
  canceledAt?: string
}

/** 초대 생성 요청입니다. */
export const InvitationInput = Schema.Struct({
  email: Schema.String.check(Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)),
  name: Schema.optionalKey(Schema.NonEmptyString),
  access: MemberAccess,
  /** `MEMBER`일 때 줄 권한 그룹입니다. `ADMIN`이면 무시합니다. */
  roleIds: Schema.Array(IdSchema('role')),
})

export type InvitationInput = typeof InvitationInput.Type

/** 초대 링크로 보는 공개 요약입니다. 회사 이름과 초대받은 이메일만 보입니다. */
export const InvitationPreview = Schema.Struct({
  companyName: Schema.String,
  email: Schema.String,
  inviterName: Schema.String,
  status: InvitationStatusSchema,
  /** 이미 가입한 이메일이면 로그인 후 수락합니다. 아니면 비밀번호와 약관 동의로 가입하며 수락합니다. */
  isExistingUser: Schema.Boolean,
  expiresAt: Schema.String,
})

/** 링크 토큰으로 초대를 조회·수락하는 요청입니다. */
export const InvitationToken = Schema.Struct({ token: Schema.NonEmptyString })

/** 초대 수락 요청입니다. 새 사용자는 이름·비밀번호·약관 응답을 함께 보냅니다. */
export const InvitationAcceptance = Schema.Struct({
  token: Schema.NonEmptyString,
  name: Schema.optionalKey(Schema.NonEmptyString),
  password: Schema.optionalKey(Schema.String),
  agreedTermIds: Schema.optionalKey(Schema.Array(TermId)),
})

export type InvitationAcceptance = typeof InvitationAcceptance.Type

/** 요청한 초대가 없거나 링크 토큰이 틀렸습니다. */
export class InvitationNotFound extends HttpApiError.Problem<InvitationNotFound>()(
  'InvitationNotFound',
  { type: problemType('INVITATION_NOT_FOUND'), status: 404, title: 'Invitation not found' },
  { code: Schema.tag('INVITATION_NOT_FOUND') },
) {}

/** 이미 이 회사의 구성원인 이메일을 초대했습니다. */
export class InviteeAlreadyMember extends HttpApiError.Problem<InviteeAlreadyMember>()(
  'InviteeAlreadyMember',
  { type: problemType('INVITEE_ALREADY_MEMBER'), status: 409, title: 'User is already a member' },
  { code: Schema.tag('INVITEE_ALREADY_MEMBER') },
) {}

/** 같은 이메일에 유효한 초대가 있습니다. 취소한 뒤 다시 초대합니다. */
export class InvitationAlreadyPending extends HttpApiError.Problem<InvitationAlreadyPending>()(
  'InvitationAlreadyPending',
  { type: problemType('INVITATION_ALREADY_PENDING'), status: 409, title: 'Invitation is already pending' },
  { code: Schema.tag('INVITATION_ALREADY_PENDING'), invitationId: InvitationId },
) {}

/** 초대가 만료·취소·수락되어 더 쓸 수 없습니다. `reason`이 사유입니다. */
export class InvitationClosed extends HttpApiError.Problem<InvitationClosed>()(
  'InvitationClosed',
  { type: problemType('INVITATION_CLOSED'), status: 410, title: 'Invitation is no longer valid' },
  {
    code: Schema.tag('INVITATION_CLOSED'),
    reason: Schema.Literals(['INVITATION_EXPIRED', 'INVITATION_CANCELED', 'INVITATION_ALREADY_ACCEPTED']),
  },
) {}

/** 이미 가입한 이메일의 초대를 로그인하지 않았거나 다른 계정으로 수락하려 했습니다. */
export class InvitationAccountMismatch extends HttpApiError.Problem<InvitationAccountMismatch>()(
  'InvitationAccountMismatch',
  { type: problemType('INVITATION_ACCOUNT_MISMATCH'), status: 403, title: 'Sign in as the invited email' },
  { code: Schema.tag('INVITATION_ACCOUNT_MISMATCH') },
) {}
