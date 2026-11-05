import { Context, Effect, Layer, Option } from 'effect'
import type { PageOf, PageQuery } from '../../../shared/http/pagination.ts'
import { paginate } from '../../../shared/http/pagination.ts'
import { checkVersion } from '../../../shared/http/versioning.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { VersionMismatch } from '../../../shared/problem/problem.ts'
import { ensureAssignable, loadAccountTitleIndex } from '../account-titles/account-title-index.ts'
import type { AccountTitleNotAssignable } from '../account-titles/account-title.ts'
import { newestFirstKey, orFail } from '../common/lookup.ts'
import { AccountTitleRepository, EvidenceRepository, PartnerRepository } from '../common/repositories.ts'
import { evidenceAmounts } from './evidence-amounts.ts'
import type { Evidence } from './evidence.ts'
import { BatchTargetMissing, EvidenceNotFound, PartnerNotFound, VatDeductionNotApplicable } from './evidence.ts'
import type { EvidenceRecord, EvidenceSide, EvidenceSource, VatDeduction } from './evidence.types.ts'

/** 증빙 목록 필터입니다. 기간은 작성일자 기준입니다. */
export interface EvidenceFilter {
  side?: EvidenceSide
  source?: EvidenceSource
  from?: string
  to?: string
  classification?: 'CLASSIFIED' | 'UNCLASSIFIED'
  partnerId?: Id<'partner'>
  /** 상호·품목에 들어 있는 글자입니다. */
  search?: string
}

/** 증빙 수정 입력입니다. 없는 키는 그대로 둡니다. */
export interface EvidenceChanges {
  memo?: string | null
  vatDeduction?: VatDeduction
  partnerId?: Id<'partner'> | null
}

/** 저장한 증빙을 응답 모양으로 바꿉니다. */
export function toEvidence(record: EvidenceRecord): Evidence {
  const { vatEstimated, ...amounts } = evidenceAmounts(record)
  return {
    id: record.id,
    side: record.side,
    source: record.source,
    writtenOn: record.writtenOn,
    issuedOn: record.issuedOn,
    docType: record.docType,
    kind: record.kind,
    counterparty: { name: record.counterpartyName, businessNumber: record.counterpartyBusinessNumber },
    itemSummary: record.itemSummary,
    amounts,
    vatEstimated,
    partnerId: record.partnerId,
    classification: {
      status: record.classification.accountTitleId === null ? 'UNCLASSIFIED' : 'CLASSIFIED',
      ...record.classification,
    },
    memo: record.memo,
    vatDeduction: record.vatDeduction,
    card: record.card,
    channel: record.channel,
    isCanceled: record.isCanceled,
    salesTransactionId: record.salesTransactionId,
    syncedAt: record.syncedAt,
    version: record.version,
  }
}

/** 필터에 맞는지입니다. 목록과 건수가 같은 조건을 씁니다. */
function matches(record: EvidenceRecord, filter: EvidenceFilter, byClassification = true): boolean {
  if (filter.side !== undefined && record.side !== filter.side) return false
  if (filter.source !== undefined && record.source !== filter.source) return false
  if (filter.from !== undefined && record.writtenOn < filter.from) return false
  if (filter.to !== undefined && record.writtenOn > filter.to) return false
  if (filter.partnerId !== undefined && record.partnerId !== filter.partnerId) return false
  if (byClassification && filter.classification !== undefined) {
    const classified = record.classification.accountTitleId !== null
    if (classified !== (filter.classification === 'CLASSIFIED')) return false
  }
  const term = filter.search?.trim().toLowerCase() ?? ''
  if (term !== '') {
    const text = `${record.counterpartyName ?? ''} ${record.itemSummary ?? ''}`.toLowerCase()
    if (!text.includes(term)) return false
  }
  return true
}

/** 매출·매입 증빙 조회와 분류입니다. */
export class EvidenceService extends Context.Service<
  EvidenceService,
  {
    list(companyId: Id<'company'>, filter: EvidenceFilter, page: PageQuery): Effect.Effect<PageOf<Evidence>>
    count(
      companyId: Id<'company'>,
      filter: EvidenceFilter,
    ): Effect.Effect<{ totalCount: number; classifiedCount: number; unclassifiedCount: number }>
    get(companyId: Id<'company'>, id: Id<'evidence'>): Effect.Effect<Evidence, EvidenceNotFound>
    update(
      companyId: Id<'company'>,
      id: Id<'evidence'>,
      changes: EvidenceChanges,
      expectedVersion: number | undefined,
    ): Effect.Effect<Evidence, EvidenceNotFound | VatDeductionNotApplicable | PartnerNotFound | VersionMismatch>
    /** 계정과목(`null`이면 분류 해제)과 거래처를 사람이 정합니다. */
    classify(
      companyId: Id<'company'>,
      id: Id<'evidence'>,
      input: { accountTitleId: Id<'accountTitle'> | null; partnerId?: Id<'partner'> | null },
      expectedVersion: number | undefined,
    ): Effect.Effect<Evidence, EvidenceNotFound | AccountTitleNotAssignable | PartnerNotFound | VersionMismatch>
    /** 여러 증빙을 한 계정과목으로 분류합니다. 하나라도 없거나 분류할 수 없으면 아무것도 바꾸지 않습니다. */
    batchClassify(
      companyId: Id<'company'>,
      ids: ReadonlyArray<Id<'evidence'>>,
      accountTitleId: Id<'accountTitle'> | null,
    ): Effect.Effect<{ updatedCount: number }, BatchTargetMissing | AccountTitleNotAssignable>
  }
>()('semu/bookkeeping/EvidenceService') {
  static readonly layer = Layer.effect(
    EvidenceService,
    Effect.gen(function* () {
      const repository = yield* EvidenceRepository
      const partners = yield* PartnerRepository
      const titles = yield* AccountTitleRepository
      const withTitles = Effect.provideService(AccountTitleRepository, titles)

      const find = (companyId: Id<'company'>, id: Id<'evidence'>) =>
        orFail(repository.findById(companyId, id), () => new EvidenceNotFound({}))

      const ensurePartner = (companyId: Id<'company'>, partnerId: Id<'partner'> | null | undefined) =>
        partnerId === null || partnerId === undefined
          ? Effect.void
          : partners
              .findById(companyId, partnerId)
              .pipe(
                Effect.flatMap((found) =>
                  Option.isSome(found) && found.value.deletedAt === null
                    ? Effect.void
                    : Effect.fail(new PartnerNotFound({})),
                ),
              )

      return EvidenceService.of({
        list: (companyId, filter, page) =>
          Effect.map(repository.list(companyId), (rows) => {
            const sorted = rows
              .filter((row) => matches(row, filter))
              .map((row) => ({ key: newestFirstKey(row.writtenOn, row.id), row }))
              .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
            const result = paginate(sorted, (entry) => entry.key, page)
            return { ...result, items: result.items.map((entry) => toEvidence(entry.row)) }
          }),

        count: (companyId, filter) =>
          Effect.map(repository.list(companyId), (rows) => {
            const matched = rows.filter((row) => matches(row, filter, false))
            const classifiedCount = matched.filter((row) => row.classification.accountTitleId !== null).length
            return {
              totalCount: matched.length,
              classifiedCount,
              unclassifiedCount: matched.length - classifiedCount,
            }
          }),

        get: (companyId, id) => Effect.map(find(companyId, id), toEvidence),

        update: Effect.fn('EvidenceService.update')(function* (companyId, id, changes, expectedVersion) {
          const record = yield* find(companyId, id)
          yield* checkVersion(record.version, expectedVersion)
          if (changes.vatDeduction !== undefined && record.side === 'SALES') {
            return yield* new VatDeductionNotApplicable({})
          }
          yield* ensurePartner(companyId, changes.partnerId)
          const next: EvidenceRecord = {
            ...record,
            ...(changes.memo === undefined ? {} : { memo: changes.memo }),
            ...(changes.vatDeduction === undefined ? {} : { vatDeduction: changes.vatDeduction }),
            ...(changes.partnerId === undefined ? {} : { partnerId: changes.partnerId }),
            version: record.version + 1,
          }
          yield* repository.save(next)
          return toEvidence(next)
        }),

        classify: Effect.fn('EvidenceService.classify')(function* (companyId, id, input, expectedVersion) {
          const record = yield* find(companyId, id)
          yield* checkVersion(record.version, expectedVersion)
          if (input.accountTitleId !== null) {
            const index = yield* withTitles(loadAccountTitleIndex(companyId))
            yield* ensureAssignable(index, input.accountTitleId, record.side)
          }
          yield* ensurePartner(companyId, input.partnerId)
          const next: EvidenceRecord = {
            ...record,
            classification:
              input.accountTitleId === null
                ? { accountTitleId: null, method: null, ruleId: null }
                : { accountTitleId: input.accountTitleId, method: 'MANUAL', ruleId: null },
            ...(input.partnerId === undefined ? {} : { partnerId: input.partnerId }),
            version: record.version + 1,
          }
          yield* repository.save(next)
          return toEvidence(next)
        }),

        batchClassify: Effect.fn('EvidenceService.batchClassify')(function* (companyId, ids, accountTitleId) {
          const rows = yield* repository.list(companyId)
          const byId = new Map(rows.map((row) => [row.id, row]))
          const missingIds = ids.filter((id) => !byId.has(id))
          if (missingIds.length > 0) return yield* new BatchTargetMissing({ missingIds })
          const targets = [...new Set(ids)].map((id) => byId.get(id)!)
          if (accountTitleId !== null) {
            const index = yield* withTitles(loadAccountTitleIndex(companyId))
            for (const side of new Set(targets.map((row) => row.side))) {
              yield* ensureAssignable(index, accountTitleId, side)
            }
          }
          yield* repository.saveAll(
            targets.map((row) => ({
              ...row,
              classification:
                accountTitleId === null
                  ? { accountTitleId: null, method: null, ruleId: null }
                  : { accountTitleId, method: 'MANUAL' as const, ruleId: null },
              version: row.version + 1,
            })),
          )
          return { updatedCount: targets.length }
        }),
      })
    }),
  )
}
