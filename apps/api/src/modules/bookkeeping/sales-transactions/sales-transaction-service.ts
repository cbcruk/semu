import { Context, Effect, Layer } from 'effect'
import type { PageOf, PageQuery } from '../../../shared/http/pagination.ts'
import { paginate } from '../../../shared/http/pagination.ts'
import { checkVersion } from '../../../shared/http/versioning.ts'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { VersionMismatch } from '../../../shared/problem/problem.ts'
import { newestFirstKey, nowAndToday, orFail } from '../common/lookup.ts'
import { EvidenceRepository, SalesTransactionRepository, TaxInvoiceRepository } from '../common/repositories.ts'
import type { EvidenceRecord } from '../evidence/evidence.types.ts'
import { HometaxInvoiceIssuer } from '../ports/hometax-invoice-issuer.ts'
import type { SalesTransactionRecord, TaxInvoiceRecord, TransactionParty } from './sales-transaction.types.ts'
import type { SalesTransaction, TaxInvoice } from './sales-transaction.ts'
import {
  IdempotencyKeyReused,
  SalesStatementInvalid,
  SalesTransactionLocked,
  SalesTransactionNotFound,
  TaxInvoiceNotFound,
  TaxInvoiceRejected,
} from './sales-transaction.ts'
import { issueStatusOf, itemSummary, statementLock, statementProblems } from './statement-validation.ts'

/** 거래명세서 입력입니다. 공급자·공급받는 자의 빠진 값은 `null`로 둡니다. */
export type StatementInput = Omit<
  SalesTransactionRecord,
  'id' | 'companyId' | 'supplier' | 'buyer' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'version'
> & {
  supplier: Partial<TransactionParty>
  buyer: Partial<TransactionParty>
}

const EMPTY_PARTY: TransactionParty = {
  businessNumber: null,
  branchNumber: null,
  companyName: null,
  representativeName: null,
  address: null,
  businessType: null,
  businessItem: null,
  email: null,
  contactName: null,
  contactDepartment: null,
  mobileNumber: null,
  phoneNumber: null,
}

function toSalesTransaction(row: SalesTransactionRecord, invoices: ReadonlyArray<TaxInvoiceRecord>): SalesTransaction {
  const { companyId: _company, deletedAt: _deleted, ...rest } = row
  return {
    ...rest,
    items: [...row.items],
    itemSummary: itemSummary(row.items),
    issueStatus: issueStatusOf(invoices.filter((invoice) => invoice.salesTransactionId === row.id)),
  }
}

function toTaxInvoice(row: TaxInvoiceRecord): TaxInvoice {
  const { companyId: _company, idempotencyKey: _key, statement: _statement, ...rest } = row
  return rest
}

/** 거래명세서 작성과 세금계산서 발급입니다. */
export class SalesTransactionService extends Context.Service<
  SalesTransactionService,
  {
    list(
      companyId: Id<'company'>,
      filter: { from?: string; to?: string; issueStatus?: 'ISSUE_REQUIRED' | 'ISSUED' },
      page: PageQuery,
    ): Effect.Effect<PageOf<SalesTransaction>>
    get(companyId: Id<'company'>, id: Id<'salesTransaction'>): Effect.Effect<SalesTransaction, SalesTransactionNotFound>
    create(companyId: Id<'company'>, input: StatementInput): Effect.Effect<SalesTransaction, SalesStatementInvalid>
    update(
      companyId: Id<'company'>,
      id: Id<'salesTransaction'>,
      changes: Partial<StatementInput>,
      expectedVersion: number | undefined,
    ): Effect.Effect<
      SalesTransaction,
      SalesTransactionNotFound | SalesStatementInvalid | SalesTransactionLocked | VersionMismatch
    >
    remove(
      companyId: Id<'company'>,
      id: Id<'salesTransaction'>,
    ): Effect.Effect<void, SalesTransactionNotFound | SalesTransactionLocked>
    /**
     * 세금계산서를 발급합니다. 같은 키로 다시 부르면 처음 결과를 그대로 돌려줍니다.
     *
     * 발급에 성공하면 매출 세금계산서 증빙을 바로 만들고 거래명세서와 잇습니다. 이후 홈택스 수집이 같은 승인번호로 덮어씁니다.
     */
    issue(
      companyId: Id<'company'>,
      salesTransactionId: Id<'salesTransaction'>,
      idempotencyKey: string,
    ): Effect.Effect<
      { invoice: TaxInvoice; replayed: boolean },
      | SalesTransactionNotFound
      | SalesStatementInvalid
      | SalesTransactionLocked
      | TaxInvoiceRejected
      | IdempotencyKeyReused
    >
    listInvoices(
      companyId: Id<'company'>,
      salesTransactionId: Id<'salesTransaction'> | undefined,
    ): Effect.Effect<TaxInvoice[]>
    getInvoice(companyId: Id<'company'>, id: Id<'taxInvoice'>): Effect.Effect<TaxInvoice, TaxInvoiceNotFound>
    /** 발급분 상세를 홈택스에서 다시 확인합니다. */
    syncInvoice(companyId: Id<'company'>, id: Id<'taxInvoice'>): Effect.Effect<TaxInvoice, TaxInvoiceNotFound>
  }
>()('semu/bookkeeping/SalesTransactionService') {
  static readonly layer = Layer.effect(
    SalesTransactionService,
    Effect.gen(function* () {
      const repository = yield* SalesTransactionRepository
      const invoices = yield* TaxInvoiceRepository
      const evidence = yield* EvidenceRepository
      const issuer = yield* HometaxInvoiceIssuer

      const find = (companyId: Id<'company'>, id: Id<'salesTransaction'>) =>
        Effect.flatMap(
          orFail(repository.findById(companyId, id), () => new SalesTransactionNotFound({})),
          (row) => (row.deletedAt === null ? Effect.succeed(row) : Effect.fail(new SalesTransactionNotFound({}))),
        )
      const findInvoice = (companyId: Id<'company'>, id: Id<'taxInvoice'>) =>
        orFail(invoices.findById(companyId, id), () => new TaxInvoiceNotFound({}))
      const invoicesOf = (companyId: Id<'company'>, id: Id<'salesTransaction'>) =>
        Effect.map(invoices.list(companyId), (rows) => rows.filter((row) => row.salesTransactionId === id))

      const validate = (statement: Parameters<typeof statementProblems>[0]) => {
        const problems = statementProblems(statement)
        return problems.length === 0 ? Effect.void : Effect.fail(new SalesStatementInvalid({ problems }))
      }
      const ensureEditable = (rows: ReadonlyArray<TaxInvoiceRecord>) => {
        const lock = statementLock(rows)
        return lock === 'EDITABLE' ? Effect.void : Effect.fail(new SalesTransactionLocked({ lock }))
      }

      return SalesTransactionService.of({
        list: Effect.fn('SalesTransactionService.list')(function* (companyId, filter, page) {
          const allInvoices = yield* invoices.list(companyId)
          const rows = (yield* repository.list(companyId))
            .filter(
              (row) =>
                row.deletedAt === null &&
                (filter.from === undefined || row.writeDate >= filter.from) &&
                (filter.to === undefined || row.writeDate <= filter.to),
            )
            .map((row) => toSalesTransaction(row, allInvoices))
            .filter((row) => filter.issueStatus === undefined || row.issueStatus === filter.issueStatus)
            .map((row) => ({ key: newestFirstKey(row.writeDate, row.id), row }))
            .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
          const result = paginate(rows, (entry) => entry.key, page)
          return { ...result, items: result.items.map((entry) => entry.row) }
        }),

        get: Effect.fn('SalesTransactionService.get')(function* (companyId, id) {
          return toSalesTransaction(yield* find(companyId, id), yield* invoicesOf(companyId, id))
        }),

        create: Effect.fn('SalesTransactionService.create')(function* (companyId, input) {
          yield* validate(input)
          const { now } = yield* nowAndToday
          const record: SalesTransactionRecord = {
            ...input,
            id: newId('salesTransaction'),
            companyId,
            supplier: { ...EMPTY_PARTY, ...input.supplier },
            buyer: { ...EMPTY_PARTY, ...input.buyer },
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
            version: 1,
          }
          yield* repository.save(record)
          return toSalesTransaction(record, [])
        }),

        update: Effect.fn('SalesTransactionService.update')(function* (companyId, id, changes, expectedVersion) {
          const row = yield* find(companyId, id)
          yield* checkVersion(row.version, expectedVersion)
          const existing = yield* invoicesOf(companyId, id)
          yield* ensureEditable(existing)
          const { supplier, buyer, ...plain } = changes
          const { now } = yield* nowAndToday
          const next: SalesTransactionRecord = {
            ...row,
            ...plain,
            supplier: { ...row.supplier, ...supplier },
            buyer: { ...row.buyer, ...buyer },
            updatedAt: now,
            version: row.version + 1,
          }
          yield* validate(next)
          yield* repository.save(next)
          return toSalesTransaction(next, existing)
        }),

        remove: Effect.fn('SalesTransactionService.remove')(function* (companyId, id) {
          const row = yield* find(companyId, id)
          yield* ensureEditable(yield* invoicesOf(companyId, id))
          const { now } = yield* nowAndToday
          yield* repository.save({ ...row, deletedAt: now, version: row.version + 1 })
        }),

        issue: Effect.fn('SalesTransactionService.issue')(function* (companyId, salesTransactionId, idempotencyKey) {
          const previous = (yield* invoices.list(companyId)).find((row) => row.idempotencyKey === idempotencyKey)
          if (previous !== undefined) {
            if (previous.salesTransactionId !== salesTransactionId) return yield* new IdempotencyKeyReused({})
            if (previous.status === 'FAILED') {
              return yield* new TaxInvoiceRejected({
                taxInvoiceId: previous.id,
                errorCode: previous.failure?.code ?? 'UNKNOWN',
                errorMessage: previous.failure?.message ?? '',
              })
            }
            return { invoice: toTaxInvoice(previous), replayed: true }
          }
          const statement = yield* find(companyId, salesTransactionId)
          yield* validate(statement)
          yield* ensureEditable(yield* invoicesOf(companyId, salesTransactionId))
          const { now } = yield* nowAndToday
          const pending: TaxInvoiceRecord = {
            id: newId('taxInvoice'),
            companyId,
            salesTransactionId,
            idempotencyKey,
            status: 'ISSUING',
            approvalNumber: null,
            issuedAt: null,
            detailSynced: false,
            failure: null,
            statement,
            createdAt: now,
            updatedAt: now,
          }
          yield* invoices.save(pending)
          const result = yield* issuer.issue({
            companyId,
            salesTransactionId,
            idempotencyKey,
            writeDate: statement.writeDate,
            buyerBusinessNumber: statement.buyer.businessNumber,
            statement,
          })
          if (!result.ok) {
            const failed: TaxInvoiceRecord = {
              ...pending,
              status: 'FAILED',
              failure: { code: result.errorCode, message: result.errorMessage },
            }
            yield* invoices.save(failed)
            return yield* new TaxInvoiceRejected({
              taxInvoiceId: failed.id,
              errorCode: result.errorCode,
              errorMessage: result.errorMessage,
            })
          }
          const issued: TaxInvoiceRecord = {
            ...pending,
            status: 'ISSUED',
            approvalNumber: result.approvalNumber,
            issuedAt: result.issuedAt,
          }
          yield* invoices.save(issued)
          yield* evidence.save(issuedEvidence(statement, issued, now))
          return { invoice: toTaxInvoice(issued), replayed: false }
        }),

        listInvoices: (companyId, salesTransactionId) =>
          Effect.map(invoices.list(companyId), (rows) =>
            rows
              .filter((row) => salesTransactionId === undefined || row.salesTransactionId === salesTransactionId)
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
              .map(toTaxInvoice),
          ),

        getInvoice: (companyId, id) => Effect.map(findInvoice(companyId, id), toTaxInvoice),

        syncInvoice: Effect.fn('SalesTransactionService.syncInvoice')(function* (companyId, id) {
          const row = yield* findInvoice(companyId, id)
          if (row.approvalNumber === null) return toTaxInvoice(row)
          const detail = yield* issuer.fetchDetail(companyId, row.approvalNumber)
          const { now } = yield* nowAndToday
          const next = { ...row, detailSynced: detail.found, updatedAt: now }
          yield* invoices.save(next)
          return toTaxInvoice(next)
        }),
      })
    }),
  )
}

/** 발급한 세금계산서의 매출 증빙입니다. 수집 키는 승인번호라 이후 홈택스 수집과 겹치지 않습니다. */
function issuedEvidence(statement: SalesTransactionRecord, invoice: TaxInvoiceRecord, now: string): EvidenceRecord {
  return {
    id: newId('evidence'),
    companyId: statement.companyId,
    side: 'SALES',
    source: 'TAX_INVOICE',
    externalKey: invoice.approvalNumber ?? invoice.id,
    writtenOn: statement.writeDate,
    issuedOn: (invoice.issuedAt ?? now).slice(0, 10),
    docType: statement.invoiceClassCode === '03' ? 'INVOICE' : 'TAX_INVOICE',
    kind: statement.invoiceKindCode === '02' ? 'ZERO_RATE' : 'NORMAL',
    counterpartyName: statement.buyer.companyName,
    counterpartyBusinessNumber: statement.buyer.businessNumber,
    itemSummary: itemSummary(statement.items),
    totalAmount: statement.totalAmount,
    supplyAmount: statement.supplyAmount,
    vatAmount: statement.vatAmount,
    partnerId: statement.partnerId,
    classification: { accountTitleId: null, method: null, ruleId: null },
    memo: null,
    vatDeduction: 'UNDECIDED',
    card: null,
    channel: null,
    isCanceled: false,
    dedupeGroup: null,
    salesTransactionId: statement.id,
    syncedAt: now,
    version: 1,
  }
}
