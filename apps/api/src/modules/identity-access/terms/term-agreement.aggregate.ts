import { Result } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { Actor } from '../actor.types.ts'
import type { AuditInput } from '../audit/audit-log.ts'
import {
  RequiredTermDeclined,
  RequiredTermsMissing,
  TermVersionOutdated,
  type AgreementRecord,
  type Term,
} from './term.ts'

/**
 * 약관 동의 애그리거트입니다(docs/design/domain-model.md). 사용자의 동의 기록은 덧붙이기만 합니다. 응답과 가입 동의의 판정 함수
 * (`decide…`)를 둡니다.
 *
 * 판정 함수는 순수 함수입니다. 지금 적용되는 약관(버전)은 서비스가 읽어 넘깁니다. 응답 뒤 access token 폐기는 서비스가 같은 트랜잭션에서
 * 합니다(M5).
 */

/** 약관 응답 하나입니다. */
export interface TermDecision {
  termId: Id<'term'>
  agreed: boolean
}

function agreementOf(userId: Id<'user'>, term: Term, agreed: boolean, decidedAt: string): AgreementRecord {
  return { userId, termId: term.id, code: term.code, version: term.version, agreed, decidedAt }
}

/**
 * 약관 응답을 판정합니다. 지금 적용되는 버전이 아닌 약관 ID는 `TermVersionOutdated`, 필수 약관 거절은 `RequiredTermDeclined`이고 이
 * 순서로 봅니다. 응답마다 동의 기록 하나와 `TERMS_DECIDED` 감사 기록을 남깁니다.
 */
export function decideTermResponses(
  applicable: ReadonlyArray<Term>,
  decisions: ReadonlyArray<TermDecision>,
  actor: Actor,
  decidedAt: string,
): Result.Result<{ agreements: AgreementRecord[]; audit: AuditInput[] }, TermVersionOutdated | RequiredTermDeclined> {
  const answered = decisions.map((decision) => ({
    decision,
    term: applicable.find((term) => term.id === decision.termId),
  }))
  const outdated = answered.filter((entry) => entry.term === undefined).map((entry) => entry.decision.termId)
  if (outdated.length > 0) return Result.fail(new TermVersionOutdated({ termIds: outdated }))
  const declined = answered.flatMap(({ decision, term }) =>
    term !== undefined && term.required && !decision.agreed ? [term.code] : [],
  )
  if (declined.length > 0) return Result.fail(new RequiredTermDeclined({ termCodes: declined }))
  return Result.succeed({
    agreements: answered.flatMap(({ decision, term }) =>
      term === undefined ? [] : [agreementOf(actor.userId, term, decision.agreed, decidedAt)],
    ),
    audit: [
      {
        action: 'TERMS_DECIDED',
        companyId: actor.companyId,
        actorUserId: actor.userId,
        actorKind: actor.kind,
        detail: decisions.map((d) => `${d.termId}=${d.agreed ? 'AGREED' : 'DECLINED'}`).join(','),
      },
    ],
  })
}

/**
 * 가입·초대 수락의 약관 동의를 판정합니다. 가입 약관(`SIGNUP`)의 지금 버전이 아닌 ID는 `TermVersionOutdated`, 빠진 필수 약관은
 * `RequiredTermsMissing`입니다. 가입 약관마다 동의 기록을 남기고, 선택 약관은 `agreedTermIds`에 없으면 거절로 남깁니다.
 */
export function decideSignupAgreements(
  signupTerms: ReadonlyArray<Term>,
  agreedTermIds: ReadonlyArray<Id<'term'>>,
  userId: Id<'user'>,
  decidedAt: string,
): Result.Result<{ agreements: AgreementRecord[] }, TermVersionOutdated | RequiredTermsMissing> {
  const unknown = agreedTermIds.filter((id) => !signupTerms.some((term) => term.id === id))
  if (unknown.length > 0) return Result.fail(new TermVersionOutdated({ termIds: unknown }))
  const missing = signupTerms.filter((term) => term.required && !agreedTermIds.includes(term.id))
  if (missing.length > 0) return Result.fail(new RequiredTermsMissing({ termCodes: missing.map((term) => term.code) }))
  return Result.succeed({
    agreements: signupTerms.map((term) => agreementOf(userId, term, agreedTermIds.includes(term.id), decidedAt)),
  })
}
