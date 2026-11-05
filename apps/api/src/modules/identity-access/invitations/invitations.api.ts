import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import {
  EntitlementRequired,
  PermissionDenied,
  TermsReagreementRequired,
  TokenScopeMismatch,
  ValidationFailed,
} from '../../../shared/problem/problem.ts'
import { InvalidCredentials, PasswordPolicyViolated } from '../accounts/user.ts'
import { Authentication } from '../authentication.ts'
import { RoleNotFound } from '../roles/role.ts'
import { SessionGrant } from '../sessions/session.ts'
import { RequiredTermsMissing, TermVersionOutdated } from '../terms/term.ts'
import {
  Invitation,
  InvitationAcceptance,
  InvitationAccountMismatch,
  InvitationAlreadyPending,
  InvitationClosed,
  InvitationId,
  InvitationInput,
  InvitationNotFound,
  InvitationPreview,
  InvitationToken,
  InviteeAlreadyMember,
} from './invitation.ts'

const denied = [PermissionDenied, EntitlementRequired, TermsReagreementRequired]

/** 지금 회사가 보낸 초대입니다. 다시 초대는 새 초대를 만드는 것과 같습니다. */
export class InvitationsApi extends HttpApiGroup.make('invitations')
  .add(
    HttpApiEndpoint.get('list', '/invitations', {
      success: Schema.Struct({ items: Schema.Array(Invitation) }),
      error: denied,
    }),
    HttpApiEndpoint.post('create', '/invitations', {
      payload: InvitationInput,
      success: Invitation.pipe(HttpApiSchema.status(201)),
      error: [...denied, InviteeAlreadyMember, InvitationAlreadyPending, RoleNotFound],
    }),
    HttpApiEndpoint.post('cancel', '/invitations/:invitationId::cancel', {
      params: { invitationId: InvitationId },
      success: Invitation,
      error: [...denied, InvitationNotFound, InvitationClosed],
    }),
  )
  .middleware(Authentication) {}

/**
 * 초대 링크로 들어온 사람이 부르는 엔드포인트입니다. 로그인 전에도 부르므로 `Authentication`을 붙이지 않습니다.
 *
 * 토큰은 경로 대신 본문으로 받아 접근 로그에 남지 않게 합니다. 이미 로그인했다면 `Authorization`을 함께 보냅니다.
 */
export class InvitationLinksApi extends HttpApiGroup.make('invitationLinks').add(
  HttpApiEndpoint.post('preview', '/invitations::preview', {
    payload: InvitationToken,
    success: InvitationPreview,
    error: InvitationNotFound,
  }),
  HttpApiEndpoint.post('accept', '/invitations::accept', {
    headers: { authorization: Schema.optionalKey(Schema.String) },
    payload: InvitationAcceptance,
    success: HttpApiSchema.WithHeaders(SessionGrant, { 'set-cookie': Schema.String }),
    error: [
      InvitationNotFound,
      InvitationClosed,
      InvitationAccountMismatch,
      InvalidCredentials,
      PasswordPolicyViolated,
      ValidationFailed,
      RequiredTermsMissing,
      TermVersionOutdated,
      TokenScopeMismatch,
    ],
  }),
) {}
