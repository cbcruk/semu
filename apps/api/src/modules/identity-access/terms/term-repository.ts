import { Context, Effect, Layer } from 'effect'
import { TableFactory } from '../../../shared/persistence/record-table.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { Option } from 'effect'
import type { TermPurpose } from './terms-consent.types.ts'
import type { AgreementRecord, Term } from './term.ts'

/**
 * 저장한 동의 기록입니다. ID는 `${userId}:${code}:${decidedAt}`라 ID 순이 곧 사용자·코드별 응답 순입니다.
 * 같은 사용자가 같은 약관에 같은 시각에 두 번 응답하면 뒤의 응답만 남습니다.
 */
interface StoredAgreement extends AgreementRecord {
  readonly id: string
}

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
  /** 약관은 `iam_terms`, 동의 기록은 `iam_term_agreements` 표에 둡니다. 표가 비어 있으면 `terms`·`agreements`로 시작합니다. */
  static readonly layer = (terms: ReadonlyArray<Term> = [], agreements: ReadonlyArray<AgreementRecord> = []) =>
    Layer.effect(
      TermRepository,
      Effect.gen(function* () {
        const factory = yield* TableFactory
        const termTable = yield* factory.make<Term>('iam_terms', { seed: terms })
        const agreementTable = yield* factory.make<StoredAgreement>('iam_term_agreements', {
          seed: agreements.map(stored),
        })
        return TermRepository.of({
          listCurrent: (purposes, today) =>
            Effect.map(termTable.all(), (all) => {
              const current = new Map<string, Term>()
              for (const term of all) {
                if (!purposes.includes(term.purpose) || term.effectiveFrom > today) continue
                const seen = current.get(term.code)
                if (seen === undefined || seen.effectiveFrom < term.effectiveFrom) current.set(term.code, term)
              }
              return [...current.values()]
            }),
          findById: (id) => termTable.get(id),
          latestAgreements: (userId) =>
            Effect.map(agreementTable.all(), (records) => {
              const latest = new Map<string, AgreementRecord>()
              for (const { id: _, ...record } of records) if (record.userId === userId) latest.set(record.code, record)
              return latest
            }),
          appendAgreements: (records) =>
            Effect.forEach(records, (record) => agreementTable.put(stored(record)), { discard: true }),
        })
      }),
    )

  /** `terms`와 `agreements`로 시작해 프로세스 메모리에 둡니다. */
  static readonly layerMemory = (terms: ReadonlyArray<Term> = [], agreements: ReadonlyArray<AgreementRecord> = []) =>
    TermRepository.layer(terms, agreements).pipe(Layer.provide(TableFactory.layerMemory))
}

function stored(record: AgreementRecord): StoredAgreement {
  return { ...record, id: `${record.userId}:${record.code}:${record.decidedAt}` }
}
