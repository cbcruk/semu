import { Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import { problemType } from '../../../shared/problem/problem.ts'
import { EsignRequestStatusSchema } from '../esign/esign-request.ts'

/** 링크 토큰에 맞는 요청이 없습니다. */
export class EsignLinkNotFound extends HttpApiError.Problem<EsignLinkNotFound>()(
  'EsignLinkNotFound',
  { type: problemType('ESIGN_LINK_NOT_FOUND'), status: 404, title: 'Signing link not found' },
  { code: Schema.tag('ESIGN_LINK_NOT_FOUND') },
) {}

/** 요청이 닫혀(초안·취소·무효·만료·발송 실패·완료) 서명할 수 없습니다. */
export class EsignLinkClosed extends HttpApiError.Problem<EsignLinkClosed>()(
  'EsignLinkClosed',
  { type: problemType('ESIGN_LINK_CLOSED'), status: 409, title: 'Signing link is closed' },
  { code: Schema.tag('ESIGN_LINK_CLOSED'), currentStatus: EsignRequestStatusSchema },
) {}

/** 이름이나 생년월일이 맞지 않습니다. */
export class EsignVerificationFailed extends HttpApiError.Problem<EsignVerificationFailed>()(
  'EsignVerificationFailed',
  { type: problemType('ESIGN_VERIFICATION_FAILED'), status: 422, title: 'Identity does not match' },
  { code: Schema.tag('ESIGN_VERIFICATION_FAILED'), remainingAttempts: Schema.Int },
) {}

/** 본인확인을 다섯 번 틀려 링크가 잠겼습니다. 관리자가 다시 보내야 합니다. */
export class EsignVerificationLocked extends HttpApiError.Problem<EsignVerificationLocked>()(
  'EsignVerificationLocked',
  { type: problemType('ESIGN_VERIFICATION_LOCKED'), status: 429, title: 'Too many failed verifications' },
  { code: Schema.tag('ESIGN_VERIFICATION_LOCKED') },
) {}

/** 서명자 세션이 없거나 만료됐습니다. 본인확인을 다시 합니다. */
export class SignerSessionInvalid extends HttpApiError.Problem<SignerSessionInvalid>()(
  'SignerSessionInvalid',
  { type: problemType('SIGNER_SESSION_INVALID'), status: 401, title: 'Signer session required' },
  { code: Schema.tag('SIGNER_SESSION_INVALID') },
) {}
