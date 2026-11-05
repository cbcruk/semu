import { Context, Effect, Layer, Option } from 'effect'
import type { PageOf, PageQuery } from '../../../shared/http/pagination.ts'
import { paginate } from '../../../shared/http/pagination.ts'
import { checkVersion } from '../../../shared/http/versioning.ts'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { VersionMismatch } from '../../../shared/problem/problem.ts'
import { closingBalanceOn, summarizeBankAccounts } from './balance-snapshot.ts'
import type { BankAccountSummary } from './balance-snapshot.ts'
import type { BankAccountRecord, BankTransactionRecord, SettlementLinkRecord } from './bank.types.ts'
import type { BankAccount, BankTransaction } from './bank.ts'
import { BankAccountNotFound, BankTransactionNotFound, SettlementLinkInvalid } from './bank.ts'
import { settlementLinkProblem, settlementMatchStatus } from './settlement-status.ts'
import { ensureAssignable, loadAccountTitleIndex } from '../account-titles/account-title-index.ts'
import type { AccountTitleNotAssignable } from '../account-titles/account-title.ts'
import type { AccountTitleInfo } from '../account-titles/account-title.types.ts'
import { newestFirstKey, nowAndToday, orFail } from '../common/lookup.ts'
import { maskAccountNumber } from '../common/masking.ts'
import {
  AccountTitleRepository,
  BalanceSnapshotRepository,
  BankAccountRepository,
  BankTransactionRepository,
  EvidenceRepository,
  PartnerRepository,
  SettlementLinkRepository,
} from '../common/repositories.ts'
import { evidenceAmounts } from '../evidence/evidence-amounts.ts'
import { BatchTargetMissing, PartnerNotFound } from '../evidence/evidence.ts'
import { companyDateOf } from '../../../shared/time/date-format.ts'

/** 입출금 목록 필터입니다. 기간은 거래일(회사 시간대) 기준입니다. */
export interface BankTransactionFilter {
  bankAccountId?: Id<'bankAccount'>
  from?: string
  to?: string
  direction?: 'DEPOSIT' | 'WITHDRAWAL'
  classification?: 'CLASSIFIED' | 'UNCLASSIFIED'
  settlement?: 'PARTNER_REQUIRED' | 'UNMATCHED' | 'MATCHED' | 'NOT_APPLICABLE'
  search?: string
}

function toBankAccount(row: BankAccountRecord): BankAccount {
  const {
    accountNumberEncrypted: _encrypted,
    accountNumberDigest: _digest,
    accountNumberLast4,
    companyId: _company,
    ...rest
  } = row
  return { ...rest, accountNumberMasked: maskAccountNumber(`0000${accountNumberLast4}`) }
}

function toBankTransaction(
  row: BankTransactionRecord,
  links: ReadonlyArray<SettlementLinkRecord>,
  titles: ReadonlyMap<string, AccountTitleInfo>,
): BankTransaction {
  const own = links.filter((link) => link.bankTransactionId === row.id)
  const linkedAmount = own.reduce((sum, link) => sum + link.amount, 0)
  return {
    id: row.id,
    bankAccountId: row.bankAccountId,
    transactedAt: row.transactedAt,
    direction: row.direction,
    amount: row.amount,
    balanceAfter: row.balanceAfter,
    summary: row.summary,
    currencyCode: row.currencyCode,
    partnerId: row.partnerId,
    classification: {
      status: row.classification.accountTitleId === null ? 'UNCLASSIFIED' : 'CLASSIFIED',
      ...row.classification,
    },
    memo: row.memo,
    settlement: {
      status: settlementMatchStatus({
        account: row.classification.accountTitleId === null ? undefined : titles.get(row.classification.accountTitleId),
        partnerId: row.partnerId,
        amount: row.amount,
        linkedAmount,
      }),
      linkedAmount,
      links: own.map((link) => ({ id: link.id, evidenceId: link.evidenceId, amount: link.amount })),
    },
    syncedAt: row.syncedAt,
    version: row.version,
  }
}

/** 은행 계좌와 입출금 거래입니다. 계좌·거래는 수집으로만 생기고, 사람은 별칭·분류·메모·증빙 연결을 바꿉니다. */
export class BankService extends Context.Service<
  BankService,
  {
    listAccounts(companyId: Id<'company'>): Effect.Effect<BankAccount[]>
    summarizeAccounts(companyId: Id<'company'>): Effect.Effect<BankAccountSummary>
    updateAccount(
      companyId: Id<'company'>,
      id: Id<'bankAccount'>,
      changes: { alias?: string | null; cashReport?: 'INCLUDED' | 'EXCLUDED' },
      expectedVersion: number | undefined,
    ): Effect.Effect<BankAccount, BankAccountNotFound | VersionMismatch>
    balances(
      companyId: Id<'company'>,
      id: Id<'bankAccount'>,
      range: { from: string; to: string },
    ): Effect.Effect<
      { openingBalance: number; items: Array<{ date: string; closingBalance: number; source: 'SCRAPED' | 'DERIVED' }> },
      BankAccountNotFound
    >
    listTransactions(
      companyId: Id<'company'>,
      filter: BankTransactionFilter,
      page: PageQuery,
    ): Effect.Effect<PageOf<BankTransaction>>
    getTransaction(
      companyId: Id<'company'>,
      id: Id<'bankTransaction'>,
    ): Effect.Effect<BankTransaction, BankTransactionNotFound>
    updateTransaction(
      companyId: Id<'company'>,
      id: Id<'bankTransaction'>,
      changes: { memo?: string | null; partnerId?: Id<'partner'> | null },
      expectedVersion: number | undefined,
    ): Effect.Effect<BankTransaction, BankTransactionNotFound | PartnerNotFound | VersionMismatch>
    classifyTransaction(
      companyId: Id<'company'>,
      id: Id<'bankTransaction'>,
      input: { accountTitleId: Id<'accountTitle'> | null; partnerId?: Id<'partner'> | null },
      expectedVersion: number | undefined,
    ): Effect.Effect<
      BankTransaction,
      BankTransactionNotFound | AccountTitleNotAssignable | PartnerNotFound | VersionMismatch
    >
    batchClassify(
      companyId: Id<'company'>,
      ids: ReadonlyArray<Id<'bankTransaction'>>,
      accountTitleId: Id<'accountTitle'> | null,
    ): Effect.Effect<{ updatedCount: number }, BatchTargetMissing | AccountTitleNotAssignable>
    /** 거래의 증빙 연결을 통째로 바꿉니다. 빈 목록이면 연결을 모두 끊습니다. */
    link(
      companyId: Id<'company'>,
      id: Id<'bankTransaction'>,
      links: ReadonlyArray<{ evidenceId: Id<'evidence'>; amount: number }>,
      expectedVersion: number | undefined,
    ): Effect.Effect<BankTransaction, BankTransactionNotFound | SettlementLinkInvalid | VersionMismatch>
  }
>()('semu/bookkeeping/BankService') {
  static readonly layer = Layer.effect(
    BankService,
    Effect.gen(function* () {
      const accounts = yield* BankAccountRepository
      const snapshots = yield* BalanceSnapshotRepository
      const transactions = yield* BankTransactionRepository
      const linksRepo = yield* SettlementLinkRepository
      const evidence = yield* EvidenceRepository
      const partners = yield* PartnerRepository
      const titlesRepo = yield* AccountTitleRepository
      const titleIndex = (companyId: Id<'company'>) =>
        Effect.provideService(loadAccountTitleIndex(companyId), AccountTitleRepository, titlesRepo)

      const findAccount = (companyId: Id<'company'>, id: Id<'bankAccount'>) =>
        orFail(accounts.findById(companyId, id), () => new BankAccountNotFound({}))
      const findTransaction = (companyId: Id<'company'>, id: Id<'bankTransaction'>) =>
        orFail(transactions.findById(companyId, id), () => new BankTransactionNotFound({}))

      const view = Effect.fn('BankService.view')(function* (companyId: Id<'company'>, row: BankTransactionRecord) {
        return toBankTransaction(row, yield* linksRepo.list(companyId), yield* titleIndex(companyId))
      })

      const ensurePartner = (companyId: Id<'company'>, partnerId: Id<'partner'> | null | undefined) =>
        partnerId === null || partnerId === undefined
          ? Effect.void
          : Effect.flatMap(partners.findById(companyId, partnerId), (found) =>
              Option.isSome(found) && found.value.deletedAt === null
                ? Effect.void
                : Effect.fail(new PartnerNotFound({})),
            )

      return BankService.of({
        listAccounts: (companyId) =>
          Effect.map(accounts.list(companyId), (rows) =>
            [...rows]
              .sort((a, b) => a.bankCode.localeCompare(b.bankCode) || a.id.localeCompare(b.id))
              .map(toBankAccount),
          ),

        summarizeAccounts: (companyId) => Effect.map(accounts.list(companyId), summarizeBankAccounts),

        updateAccount: Effect.fn('BankService.updateAccount')(function* (companyId, id, changes, expectedVersion) {
          const row = yield* findAccount(companyId, id)
          yield* checkVersion(row.version, expectedVersion)
          const next: BankAccountRecord = {
            ...row,
            ...(changes.alias === undefined ? {} : { alias: changes.alias }),
            ...(changes.cashReport === undefined ? {} : { cashReport: changes.cashReport }),
            version: row.version + 1,
          }
          yield* accounts.save(next)
          return toBankAccount(next)
        }),

        balances: Effect.fn('BankService.balances')(function* (companyId, id, range) {
          yield* findAccount(companyId, id)
          const rows = (yield* snapshots.list(companyId)).filter((row) => row.bankAccountId === id)
          const dayBefore = rows.filter((row) => row.date < range.from)
          return {
            openingBalance: closingBalanceOn(dayBefore, range.from),
            items: rows
              .filter((row) => row.date >= range.from && row.date <= range.to)
              .sort((a, b) => a.date.localeCompare(b.date))
              .map(({ date, closingBalance, source }) => ({ date, closingBalance, source })),
          }
        }),

        listTransactions: Effect.fn('BankService.listTransactions')(function* (companyId, filter, page) {
          const links = yield* linksRepo.list(companyId)
          const titles = yield* titleIndex(companyId)
          const term = filter.search?.trim().toLowerCase() ?? ''
          const views = (yield* transactions.list(companyId))
            .filter((row) => {
              const date = companyDateOf(row.transactedAt) ?? ''
              if (filter.bankAccountId !== undefined && row.bankAccountId !== filter.bankAccountId) return false
              if (filter.from !== undefined && date < filter.from) return false
              if (filter.to !== undefined && date > filter.to) return false
              if (filter.direction !== undefined && row.direction !== filter.direction) return false
              if (filter.classification !== undefined) {
                const classified = row.classification.accountTitleId !== null
                if (classified !== (filter.classification === 'CLASSIFIED')) return false
              }
              if (term !== '' && !`${row.summary ?? ''} ${row.memo ?? ''}`.toLowerCase().includes(term)) return false
              return true
            })
            .map((row) => toBankTransaction(row, links, titles))
            .filter((row) => filter.settlement === undefined || row.settlement.status === filter.settlement)
            .map((row) => ({ key: newestFirstKey(row.transactedAt.slice(0, 16), row.id), row }))
            .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
          const result = paginate(views, (entry) => entry.key, page)
          return { ...result, items: result.items.map((entry) => entry.row) }
        }),

        getTransaction: (companyId, id) =>
          Effect.flatMap(findTransaction(companyId, id), (row) => view(companyId, row)),

        updateTransaction: Effect.fn('BankService.updateTransaction')(
          function* (companyId, id, changes, expectedVersion) {
            const row = yield* findTransaction(companyId, id)
            yield* checkVersion(row.version, expectedVersion)
            yield* ensurePartner(companyId, changes.partnerId)
            const next: BankTransactionRecord = {
              ...row,
              ...(changes.memo === undefined ? {} : { memo: changes.memo }),
              ...(changes.partnerId === undefined ? {} : { partnerId: changes.partnerId }),
              version: row.version + 1,
            }
            yield* transactions.save(next)
            return yield* view(companyId, next)
          },
        ),

        classifyTransaction: Effect.fn('BankService.classifyTransaction')(
          function* (companyId, id, input, expectedVersion) {
            const row = yield* findTransaction(companyId, id)
            yield* checkVersion(row.version, expectedVersion)
            if (input.accountTitleId !== null) {
              yield* ensureAssignable(yield* titleIndex(companyId), input.accountTitleId, row.direction)
            }
            yield* ensurePartner(companyId, input.partnerId)
            const next: BankTransactionRecord = {
              ...row,
              classification:
                input.accountTitleId === null
                  ? { accountTitleId: null, method: null, ruleId: null }
                  : { accountTitleId: input.accountTitleId, method: 'MANUAL', ruleId: null },
              ...(input.partnerId === undefined ? {} : { partnerId: input.partnerId }),
              version: row.version + 1,
            }
            yield* transactions.save(next)
            return yield* view(companyId, next)
          },
        ),

        batchClassify: Effect.fn('BankService.batchClassify')(function* (companyId, ids, accountTitleId) {
          const byId = new Map((yield* transactions.list(companyId)).map((row) => [row.id, row]))
          const missingIds = ids.filter((id) => !byId.has(id))
          if (missingIds.length > 0) return yield* new BatchTargetMissing({ missingIds })
          const targets = [...new Set(ids)].map((id) => byId.get(id)!)
          if (accountTitleId !== null) {
            const index = yield* titleIndex(companyId)
            for (const direction of new Set(targets.map((row) => row.direction))) {
              yield* ensureAssignable(index, accountTitleId, direction)
            }
          }
          yield* transactions.saveAll(
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

        link: Effect.fn('BankService.link')(function* (companyId, id, requested, expectedVersion) {
          const row = yield* findTransaction(companyId, id)
          yield* checkVersion(row.version, expectedVersion)
          const allLinks = yield* linksRepo.list(companyId)
          const evidenceById = new Map((yield* evidence.list(companyId)).map((record) => [record.id, record]))
          const candidates = []
          for (const link of requested) {
            const record = evidenceById.get(link.evidenceId)
            if (record === undefined) return yield* new SettlementLinkInvalid({ reason: 'EVIDENCE_NOT_FOUND' })
            candidates.push({
              evidenceSide: record.side,
              evidencePartnerId: record.partnerId,
              evidenceTotal: evidenceAmounts(record).totalAmount,
              linkedElsewhere: allLinks
                .filter((other) => other.evidenceId === record.id && other.bankTransactionId !== id)
                .reduce((sum, other) => sum + other.amount, 0),
              amount: link.amount,
            })
          }
          const problem = settlementLinkProblem({
            direction: row.direction,
            transactionAmount: row.amount,
            transactionPartnerId: row.partnerId,
            links: candidates,
            keptAmount: 0,
          })
          if (problem !== undefined) return yield* new SettlementLinkInvalid({ reason: problem })
          const { now } = yield* nowAndToday
          for (const old of allLinks.filter((link) => link.bankTransactionId === id)) {
            yield* linksRepo.remove(companyId, old.id)
          }
          yield* linksRepo.saveAll(
            requested.map((link) => ({
              id: newId('settlementLink'),
              companyId,
              bankTransactionId: id,
              evidenceId: link.evidenceId,
              amount: link.amount,
              createdAt: now,
            })),
          )
          const next = { ...row, version: row.version + 1 }
          yield* transactions.save(next)
          return yield* view(companyId, next)
        }),
      })
    }),
  )
}
