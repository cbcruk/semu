import { Context, Effect, Layer, Option, Ref } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { FilingStatus, TaxType } from '../tax.types.ts'
import type { FilingRecord } from './filing.types.ts'

/** 신고 건 목록 조건입니다. 비어 있으면 회사의 신고 건 전체입니다. */
export interface FilingFilter {
  taxTypes?: ReadonlyArray<TaxType>
  statuses?: ReadonlyArray<FilingStatus>
  /** 신고 기간이 이 날짜를 포함하는 신고 건만입니다. */
  covering?: string
}

/** 신고 건 저장소입니다. 회사 범위 밖의 신고 건은 읽지 않습니다. 환경마다 다른 Layer를 넣습니다. */
export class FilingRepository extends Context.Service<
  FilingRepository,
  {
    findById(companyId: Id<'company'>, id: Id<'filing'>): Effect.Effect<Option.Option<FilingRecord>>
    /** 조건에 맞는 신고 건입니다. 순서는 정하지 않습니다. */
    list(companyId: Id<'company'>, filter?: FilingFilter): Effect.Effect<ReadonlyArray<FilingRecord>>
    /** 신고 건을 저장합니다. 같은 ID가 있으면 바꿉니다. */
    save(filing: FilingRecord): Effect.Effect<void>
  }
>()('semu/tax/FilingRepository') {
  /** `seed`로 시작해 프로세스 메모리에 신고 건을 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<FilingRecord> = []) =>
    Layer.effect(
      FilingRepository,
      Effect.gen(function* () {
        const store = yield* Ref.make(new Map(seed.map((filing) => [filing.id, filing])))

        return FilingRepository.of({
          findById: (companyId, id) =>
            Ref.get(store).pipe(
              Effect.map((filings) =>
                Option.fromNullishOr(filings.get(id)).pipe(Option.filter((filing) => filing.companyId === companyId)),
              ),
            ),
          list: (companyId, filter = {}) =>
            Ref.get(store).pipe(
              Effect.map((filings) => [...filings.values()].filter((filing) => matches(filing, companyId, filter))),
            ),
          save: (filing) => Ref.update(store, (filings) => new Map(filings).set(filing.id, filing)),
        })
      }),
    )
}

function matches(filing: FilingRecord, companyId: Id<'company'>, filter: FilingFilter): boolean {
  if (filing.companyId !== companyId) return false
  if (filter.taxTypes !== undefined && !filter.taxTypes.includes(filing.taxType)) return false
  if (filter.statuses !== undefined && !filter.statuses.includes(filing.status)) return false
  if (filter.covering !== undefined && (filing.periodStart > filter.covering || filing.periodEnd < filter.covering))
    return false
  return true
}
