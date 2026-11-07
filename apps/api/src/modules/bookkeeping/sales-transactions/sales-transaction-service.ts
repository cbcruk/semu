import { keepChanges } from '../../../shared/persistence/unit-of-work.ts'
import { Context, Effect, Layer, Option } from 'effect'
import type { PageOf, PageQuery } from '../../../shared/http/pagination.ts'
import { paginate } from '../../../shared/http/pagination.ts'
import { outcomeUnknownOnDefect, runIdempotent } from '../../../shared/http/idempotency.ts'
import { checkVersion } from '../../../shared/http/versioning.ts'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type {
  ExternalOutcomeUnknown,
  IdempotencyKeyInProgress,
  IdempotencyKeyRequired,
  IdempotencyKeyReused,
  VersionMismatch,
} from '../../../shared/problem/problem.ts'
import { newestFirstKey, nowAndToday, orFail } from '../common/lookup.ts'
import {
  BookkeepingIdempotency,
  EvidenceRepository,
  PartnerRepository,
  SalesTransactionRepository,
  TaxInvoiceRepository,
} from '../common/repositories.ts'
import { PartnerNotFound } from '../evidence/evidence.ts'
import type { EvidenceRecord } from '../evidence/evidence.types.ts'
import { HometaxInvoiceIssuer } from '../ports/hometax-invoice-issuer.ts'
import type { SalesTransactionRecord, TaxInvoiceRecord, TransactionParty } from './sales-transaction.types.ts'
import type { SalesTransaction, TaxInvoice } from './sales-transaction.ts'
import {
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
    /** `partnerId`는 같은 회사의 지워지지 않은 거래처여야 합니다. 아니면 {@link PartnerNotFound}입니다. */
    create(
      companyId: Id<'company'>,
      input: StatementInput,
    ): Effect.Effect<SalesTransaction, SalesStatementInvalid | PartnerNotFound>
    update(
      companyId: Id<'company'>,
      id: Id<'salesTransaction'>,
      changes: Partial<StatementInput>,
      expectedVersion: number | undefined,
    ): Effect.Effect<
      SalesTransaction,
      SalesTransactionNotFound | SalesStatementInvalid | SalesTransactionLocked | PartnerNotFound | VersionMismatch
    >
    remove(
      companyId: Id<'company'>,
      id: Id<'salesTransaction'>,
    ): Effect.Effect<void, SalesTransactionNotFound | SalesTransactionLocked>
    /**
     * 세금계산서를 발급합니다. `Idempotency-Key`는 회사·행위자마다 따로이고, 같은 키·같은 거래명세서로 24시간 안에 다시 부르면 처음
     * 응답을 그대로 돌려줍니다. 다른 거래명세서면 422 `IDEMPOTENCY_KEY_REUSED`입니다.
     *
     * 홈택스가 거절하면 `FAILED` 발급 건은 남기고 키는 남기지 않아, 같은 키로 명세서를 고쳐 다시 보내면 새로 발급합니다. 발급 결과를
     * 확인하지 못하면 503 `EXTERNAL_OUTCOME_UNKNOWN`이고 `ISSUING` 발급 건이 명세서를 잠급니다.
     *
     * 결과를 모르는 발급 건은 누구의 발행 요청이든 마칩니다. 명세서에 `ISSUING` 발급 건이 있으면 요청한 사용자·키와 상관없이 그 건에
     * 저장한 참조로 홈택스에 다시 물어 `ISSUED`나 `FAILED`로 마치고 그 결과를 응답합니다. 처음 키의 재시도는 참조로 자기 발급 건을 찾아
     * 상태(`ISSUING`·`ISSUED`·`FAILED`)에 맞게 마칩니다. `ISSUED`로 저장한 뒤 멈췄으면 빠진 매출 증빙을 만듭니다.
     *
     * 발급에 성공하면 매출 세금계산서 증빙을 바로 만들고 거래명세서와 잇습니다. 이후 홈택스 수집이 같은 승인번호로 덮어씁니다.
     */
    issue(
      companyId: Id<'company'>,
      actorUserId: Id<'user'>,
      salesTransactionId: Id<'salesTransaction'>,
      idempotencyKey: string | undefined,
    ): Effect.Effect<
      TaxInvoice,
      | SalesTransactionNotFound
      | SalesStatementInvalid
      | SalesTransactionLocked
      | TaxInvoiceRejected
      | IdempotencyKeyRequired
      | IdempotencyKeyReused
      | IdempotencyKeyInProgress
      | ExternalOutcomeUnknown
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
      const partners = yield* PartnerRepository
      const idempotency = yield* BookkeepingIdempotency

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
      /** 다른 회사의 거래처를 이어 두지 못하게 같은 회사 안에서만 찾습니다. */
      const ensurePartner = (companyId: Id<'company'>, partnerId: Id<'partner'> | null) =>
        partnerId === null
          ? Effect.void
          : Effect.flatMap(partners.findById(companyId, partnerId), (found) =>
              Option.isSome(found) && found.value.deletedAt === null
                ? Effect.void
                : Effect.fail(new PartnerNotFound({})),
            )
      const ensureEditable = (rows: ReadonlyArray<TaxInvoiceRecord>) => {
        const lock = statementLock(rows)
        return lock === 'EDITABLE' ? Effect.void : Effect.fail(new SalesTransactionLocked({ lock }))
      }

      /** 홈택스에 지금 보내고 있는 발급 참조입니다. 메모리 저장소에서 같은 발급 건을 두 요청이 함께 마치지 않게 합니다. */
      const sending = new Set<string>()

      const rejectedBy = (invoice: TaxInvoiceRecord) =>
        new TaxInvoiceRejected({
          taxInvoiceId: invoice.id,
          errorCode: invoice.failure?.code ?? 'UNKNOWN',
          errorMessage: invoice.failure?.message ?? '',
        })

      /** 발급 건의 매출 증빙을 만듭니다. 같은 승인번호의 증빙이 이미 있으면 그대로 둡니다. */
      const ensureEvidence = (invoice: TaxInvoiceRecord, now: string) =>
        Effect.gen(function* () {
          const externalKey = invoice.approvalNumber ?? invoice.id
          const rows = yield* evidence.list(invoice.companyId)
          if (rows.some((row) => row.source === 'TAX_INVOICE' && row.externalKey === externalKey)) return
          yield* evidence.save(issuedEvidence(invoice.statement, invoice, now))
        })

      /**
       * 발급 건을 상태에 맞게 마칩니다. `ISSUING`이면 그 건의 참조로 홈택스에 물어 `ISSUED`(증빙 포함)나 `FAILED`로 바꾸고, 이미
       * `ISSUED`면 증빙을 보장하고, `FAILED`면 그 거절을 돌려줍니다. 홈택스 호출과 결과 기록 중 결함은 503입니다.
       */
      const complete = (invoice: TaxInvoiceRecord) =>
        Effect.gen(function* () {
          const { now } = yield* nowAndToday
          if (invoice.status === 'FAILED') return yield* rejectedBy(invoice)
          if (invoice.status === 'ISSUED') {
            yield* outcomeUnknownOnDefect('tax-invoice.issue', ensureEvidence(invoice, now))
            return toTaxInvoice(invoice)
          }
          const reference = invoice.idempotencyKey
          if (sending.has(reference)) return yield* new SalesTransactionLocked({ lock: 'ISSUING' })
          sending.add(reference)
          return yield* outcomeUnknownOnDefect(
            'tax-invoice.issue',
            Effect.gen(function* () {
              const statement = invoice.statement
              const result = yield* issuer.issue({
                companyId: invoice.companyId,
                salesTransactionId: invoice.salesTransactionId,
                idempotencyKey: reference,
                writeDate: statement.writeDate,
                buyerBusinessNumber: statement.buyer.businessNumber,
                statement,
              })
              if (!result.ok) {
                const failed: TaxInvoiceRecord = {
                  ...invoice,
                  status: 'FAILED',
                  failure: { code: result.errorCode, message: result.errorMessage },
                  updatedAt: now,
                }
                yield* invoices.save(failed)
                // 실패 응답(4xx)이어도 홈택스가 거절한 발행 시도는 남깁니다. 키는 남기지 않으므로 같은 키로 고쳐 다시 보낼 수 있습니다.
                yield* keepChanges
                return yield* rejectedBy(failed)
              }
              const issued: TaxInvoiceRecord = {
                ...invoice,
                status: 'ISSUED',
                approvalNumber: result.approvalNumber,
                issuedAt: result.issuedAt,
                updatedAt: now,
              }
              yield* invoices.save(issued)
              yield* evidence.save(issuedEvidence(statement, issued, now))
              return toTaxInvoice(issued)
            }),
          ).pipe(Effect.ensuring(Effect.sync(() => sending.delete(reference))))
        })

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
          yield* ensurePartner(companyId, input.partnerId)
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
          if (changes.partnerId !== undefined) yield* ensurePartner(companyId, changes.partnerId)
          yield* repository.save(next)
          return toSalesTransaction(next, existing)
        }),

        remove: Effect.fn('SalesTransactionService.remove')(function* (companyId, id) {
          const row = yield* find(companyId, id)
          yield* ensureEditable(yield* invoicesOf(companyId, id))
          const { now } = yield* nowAndToday
          yield* repository.save({ ...row, deletedAt: now, version: row.version + 1 })
        }),

        issue: (companyId, actorUserId, salesTransactionId, idempotencyKey) =>
          runIdempotent(
            {
              store: idempotency,
              companyId,
              actorUserId,
              key: idempotencyKey,
              operation: 'tax-invoice.issue',
              request: { salesTransactionId },
            },
            (attempt) =>
              Effect.gen(function* () {
                // 결과를 모르는 앞 시도를 이어 가면 그 시도의 발급 건(참조가 같음)을 상태와 상관없이 찾아 마칩니다. 다른 요청이 먼저 마쳤을 수
                // 있습니다.
                const own = attempt.resumed
                  ? (yield* invoices.list(companyId)).find(
                      (row) =>
                        row.idempotencyKey === attempt.reference && row.salesTransactionId === salesTransactionId,
                    )
                  : undefined
                if (own !== undefined) return yield* complete(own)
                const statement = yield* find(companyId, salesTransactionId)
                const existing = yield* invoicesOf(companyId, salesTransactionId)
                // 다른 사용자·키가 남긴 결과 모르는 발급 건도 그 건의 참조로 마칩니다. 처음 요청한 사람이 돌아오지 않아도 명세서가 풀립니다.
                const stranded = existing.find((row) => row.status === 'ISSUING')
                if (stranded !== undefined) return yield* complete(stranded)
                yield* validate(statement)
                yield* ensureEditable(existing)
                const { now } = yield* nowAndToday
                const pending: TaxInvoiceRecord = {
                  id: newId('taxInvoice'),
                  companyId,
                  salesTransactionId,
                  idempotencyKey: attempt.reference,
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
                return yield* complete(pending)
              }),
          ),

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
