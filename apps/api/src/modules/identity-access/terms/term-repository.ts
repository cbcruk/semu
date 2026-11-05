import { Context, Effect, Layer, Option, Ref } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { TermPurpose } from './terms-consent.types.ts'
import type { AgreementRecord, Term } from './term.ts'

/** 약관과 동의 기록 저장소입니다. 동의 기록은 덧붙이기만 합니다. */
export class TermRepository extends Context.Service<
  TermRepository,
  {
    /** 용도별 현재 약관입니다. 코드마다 `effectiveFrom <= today`인 가장 늦은 버전 하나입니다. */
    listCurrent(purposes: ReadonlyArray<TermPurpose>, today: string): Effect.Effect<Term[]>
    findById(id: Id<'term'>): Effect.Effect<Option.Option<Term>>
    /** 사용자의 약관 코드별 마지막 응답입니다. */
    latestAgreements(userId: Id<'user'>): Effect.Effect<Map<string, AgreementRecord>>
    appendAgreements(records: ReadonlyArray<AgreementRecord>): Effect.Effect<void>
  }
>()('semu/identity-access/TermRepository') {
  /** `terms`와 `agreements`로 시작해 프로세스 메모리에 둡니다. */
  static readonly layerMemory = (terms: ReadonlyArray<Term> = [], agreements: ReadonlyArray<AgreementRecord> = []) =>
    Layer.effect(
      TermRepository,
      Effect.gen(function* () {
        const log = yield* Ref.make([...agreements])
        return TermRepository.of({
          listCurrent: (purposes, today) =>
            Effect.sync(() => {
              const current = new Map<string, Term>()
              for (const term of terms) {
                if (!purposes.includes(term.purpose) || term.effectiveFrom > today) continue
                const seen = current.get(term.code)
                if (seen === undefined || seen.effectiveFrom < term.effectiveFrom) current.set(term.code, term)
              }
              return [...current.values()]
            }),
          findById: (id) => Effect.succeed(Option.fromNullishOr(terms.find((term) => term.id === id))),
          latestAgreements: (userId) =>
            Ref.get(log).pipe(
              Effect.map((records) => {
                const latest = new Map<string, AgreementRecord>()
                for (const record of records) if (record.userId === userId) latest.set(record.code, record)
                return latest
              }),
            ),
          appendAgreements: (records) => Ref.update(log, (current) => [...current, ...records]),
        })
      }),
    )
}
