import { Context, Effect, Layer, Option } from 'effect'
import { TableFactory } from '../../../shared/persistence/record-table.ts'
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
  /** `tax_filings` 표에 둡니다. 표가 비어 있으면 `seed`로 시작합니다. 저장 방식은 {@link TableFactory}가 정합니다. */
  static readonly layer = (seed: ReadonlyArray<FilingRecord> = []) =>
    Layer.effect(
      FilingRepository,
      Effect.gen(function* () {
        const table = yield* (yield* TableFactory).make<FilingRecord>('tax_filings', {
          seed,
          companyOf: (filing) => filing.companyId,
        })

        return FilingRepository.of({
          findById: (companyId, id) =>
            Effect.map(
              table.get(id),
              Option.filter((filing) => filing.companyId === companyId),
            ),
          list: (companyId, filter = {}) =>
            Effect.map(table.byCompany(companyId), (filings) =>
              filings.filter((filing) => matches(filing, companyId, filter)),
            ),
          save: (filing) => table.put(filing),
        })
      }),
    )

  /** `seed`로 시작해 프로세스 메모리에 신고 건을 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<FilingRecord> = []) =>
    FilingRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}

function matches(filing: FilingRecord, companyId: Id<'company'>, filter: FilingFilter): boolean {
  if (filing.companyId !== companyId) return false
  if (filter.taxTypes !== undefined && !filter.taxTypes.includes(filing.taxType)) return false
  if (filter.statuses !== undefined && !filter.statuses.includes(filing.status)) return false
  if (filter.covering !== undefined && (filing.periodStart > filter.covering || filing.periodEnd < filter.covering))
    return false
  return true
}
