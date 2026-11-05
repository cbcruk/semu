import { Clock, Context, Effect, Layer, Option } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { companyDate } from '../../../shared/time/company-date.ts'
import type { Actor } from '../actor.types.ts'
import { AuditLog } from '../audit/audit-log.ts'
import { Sessions } from '../sessions/sessions.ts'
import { TermRepository } from './term-repository.ts'
import { applicablePurposes, consentStatus } from './terms-consent.ts'
import type { TermPurpose } from './terms-consent.types.ts'
import { RequiredTermDeclined, RequiredTermsMissing, TermVersionOutdated } from './term.ts'
import type { AgreementRecord, Term, TermAgreement } from './term.ts'

/** 약관 응답 하나입니다. */
export interface TermDecision {
  termId: Id<'term'>
  agreed: boolean
}

/** 약관 조회와 동의 기록입니다. */
export class Terms extends Context.Service<
  Terms,
  {
    /** 용도의 현재 약관입니다. 로그인 전 가입 화면도 부릅니다. */
    current(purpose: TermPurpose): Effect.Effect<Term[]>
    /** 행위자에게 지금 적용되는 약관과 동의 상태입니다. */
    agreementsOf(actor: Actor): Effect.Effect<TermAgreement[]>
    /**
     * 약관 응답을 기록하고 행위자의 access token을 폐기합니다. 클라이언트는 refresh로 새 `pendingTermCodes`를 받습니다.
     *
     * 필수 약관 거절은 422, 지금 버전이 아닌 약관 ID는 409입니다.
     */
    decide(
      actor: Actor,
      decisions: ReadonlyArray<TermDecision>,
    ): Effect.Effect<TermAgreement[], RequiredTermDeclined | TermVersionOutdated>
    /**
     * 가입·초대 수락에서 동의한 약관이 용도의 필수 약관을 모두 덮는지 확인하고 기록합니다.
     *
     * 선택 약관은 `agreedTermIds`에 있으면 동의, 없으면 거절로 남깁니다.
     */
    recordSignup(
      userId: Id<'user'>,
      agreedTermIds: ReadonlyArray<Id<'term'>>,
    ): Effect.Effect<void, RequiredTermsMissing | TermVersionOutdated>
  }
>()('semu/identity-access/Terms') {
  static readonly layer = Layer.effect(
    Terms,
    Effect.gen(function* () {
      const repository = yield* TermRepository
      const sessions = yield* Sessions
      const audit = yield* AuditLog

      const today = Clock.currentTimeMillis.pipe(Effect.map(companyDate))
      const nowIso = Clock.currentTimeMillis.pipe(Effect.map((now) => new Date(now).toISOString()))

      const current = Effect.fn('Terms.current')(function* (purpose: TermPurpose) {
        return yield* repository.listCurrent([purpose], yield* today)
      })

      const agreementsOf = Effect.fn('Terms.agreementsOf')(function* (actor: Actor) {
        const terms = yield* repository.listCurrent(applicablePurposes(actor.plans), yield* today)
        const history = yield* repository.latestAgreements(actor.userId)
        return terms.map((term): TermAgreement => {
          const last = history.get(term.code)
          return {
            term,
            status: consentStatus(term, last),
            ...(last === undefined
              ? {}
              : { lastDecision: { version: last.version, agreed: last.agreed, decidedAt: last.decidedAt } }),
          }
        })
      })

      const decide = Effect.fn('Terms.decide')(function* (actor: Actor, decisions: ReadonlyArray<TermDecision>) {
        const applicable = yield* repository.listCurrent(applicablePurposes(actor.plans), yield* today)
        const outdated = decisions.filter((decision) => !applicable.some((term) => term.id === decision.termId))
        if (outdated.length > 0) return yield* new TermVersionOutdated({ termIds: outdated.map((d) => d.termId) })
        const declined = decisions.flatMap((decision) => {
          const term = applicable.find((entry) => entry.id === decision.termId)
          return term !== undefined && term.required && !decision.agreed ? [term.code] : []
        })
        if (declined.length > 0) return yield* new RequiredTermDeclined({ termCodes: declined })

        const decidedAt = yield* nowIso
        yield* repository.appendAgreements(
          decisions.map((decision): AgreementRecord => {
            const term = applicable.find((entry) => entry.id === decision.termId)!
            return {
              userId: actor.userId,
              termId: term.id,
              code: term.code,
              version: term.version,
              agreed: decision.agreed,
              decidedAt,
            }
          }),
        )
        yield* audit.record({
          action: 'TERMS_DECIDED',
          companyId: actor.companyId,
          actorUserId: actor.userId,
          actorKind: actor.kind,
          detail: decisions.map((d) => `${d.termId}=${d.agreed ? 'AGREED' : 'DECLINED'}`).join(','),
        })
        yield* sessions.invalidateAccess(actor.userId)
        return yield* agreementsOf(actor)
      })

      const recordSignup = Effect.fn('Terms.recordSignup')(function* (
        userId: Id<'user'>,
        agreedTermIds: ReadonlyArray<Id<'term'>>,
      ) {
        const terms = yield* repository.listCurrent(['SIGNUP'], yield* today)
        const unknown: string[] = []
        for (const id of agreedTermIds) {
          if (terms.some((term) => term.id === id)) continue
          const found = yield* repository.findById(id)
          unknown.push(Option.isSome(found) ? found.value.id : id)
        }
        if (unknown.length > 0) return yield* new TermVersionOutdated({ termIds: unknown })
        const missing = terms.filter((term) => term.required && !agreedTermIds.includes(term.id))
        if (missing.length > 0) return yield* new RequiredTermsMissing({ termCodes: missing.map((term) => term.code) })
        const decidedAt = yield* nowIso
        yield* repository.appendAgreements(
          terms.map((term) => ({
            userId,
            termId: term.id,
            code: term.code,
            version: term.version,
            agreed: agreedTermIds.includes(term.id),
            decidedAt,
          })),
        )
      })

      return Terms.of({ current, agreementsOf, decide, recordSignup })
    }),
  )
}
