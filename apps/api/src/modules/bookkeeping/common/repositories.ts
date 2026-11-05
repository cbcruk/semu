import { Context, Layer } from 'effect'
import { TableFactory } from '../../../shared/persistence/record-table.ts'
import type { AccountTitleRecord } from '../account-titles/account-title.types.ts'
import { SYSTEM_ACCOUNT_TITLES } from '../account-titles/system-account-titles.ts'
import type {
  BalanceSnapshotRecord,
  BankAccountRecord,
  BankTransactionRecord,
  SettlementLinkRecord,
} from '../bank/bank.types.ts'
import type { ClassificationRuleRecord } from '../classification/classification-rule.types.ts'
import type { EvidenceRecord } from '../evidence/evidence.types.ts'
import type { GiroPaymentRecord, GiroRecord } from '../giros/giro.types.ts'
import type { BusinessStatusCacheRecord, PartnerRecord } from '../partners/partner.types.ts'
import type { SalesTransactionRecord, TaxInvoiceRecord } from '../sales-transactions/sales-transaction.types.ts'
import { bookkeepingTable } from './table.ts'
import type { Table } from './table.ts'

/** 계정과목 저장소입니다. 기본 계정과목은 코드에 두고, 회사가 만든 계정과목만 표에 둡니다. */
export class AccountTitleRepository extends Context.Service<AccountTitleRepository, Table<AccountTitleRecord>>()(
  'semu/bookkeeping/AccountTitleRepository',
) {
  /**
   * `bookkeeping_account_titles` 표에 회사 계정과목을 둡니다. 기본 계정과목({@link SYSTEM_ACCOUNT_TITLES})은 코드에서 읽기만 합니다.
   * 표가 비어 있으면 `seed`로 시작합니다.
   */
  static readonly layer = (seed: ReadonlyArray<AccountTitleRecord> = []) =>
    Layer.effect(
      AccountTitleRepository,
      bookkeepingTable('bookkeeping_account_titles', { seed, builtIn: SYSTEM_ACCOUNT_TITLES }),
    )

  /** 기본 계정과목과 `seed`로 시작하는 메모리 저장소입니다. */
  static readonly layerMemory = (seed: ReadonlyArray<AccountTitleRecord> = []) =>
    AccountTitleRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}

/** 매출·매입 증빙 저장소입니다. */
export class EvidenceRepository extends Context.Service<EvidenceRepository, Table<EvidenceRecord>>()(
  'semu/bookkeeping/EvidenceRepository',
) {
  /** `bookkeeping_evidence` 표에 둡니다. 표가 비어 있으면 `seed`로 시작합니다. */
  static readonly layer = (seed: ReadonlyArray<EvidenceRecord> = []) =>
    Layer.effect(EvidenceRepository, bookkeepingTable('bookkeeping_evidence', { seed }))

  /** `seed`로 시작하는 메모리 저장소입니다. */
  static readonly layerMemory = (seed: ReadonlyArray<EvidenceRecord> = []) =>
    EvidenceRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}

/** 분류 규칙 저장소입니다. */
export class ClassificationRuleRepository extends Context.Service<
  ClassificationRuleRepository,
  Table<ClassificationRuleRecord>
>()('semu/bookkeeping/ClassificationRuleRepository') {
  /** `bookkeeping_classification_rules` 표에 둡니다. 표가 비어 있으면 `seed`로 시작합니다. */
  static readonly layer = (seed: ReadonlyArray<ClassificationRuleRecord> = []) =>
    Layer.effect(ClassificationRuleRepository, bookkeepingTable('bookkeeping_classification_rules', { seed }))

  /** `seed`로 시작하는 메모리 저장소입니다. */
  static readonly layerMemory = (seed: ReadonlyArray<ClassificationRuleRecord> = []) =>
    ClassificationRuleRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}

/** 은행 계좌 저장소입니다. */
export class BankAccountRepository extends Context.Service<BankAccountRepository, Table<BankAccountRecord>>()(
  'semu/bookkeeping/BankAccountRepository',
) {
  /** `bookkeeping_bank_accounts` 표에 둡니다. 표가 비어 있으면 `seed`로 시작합니다. */
  static readonly layer = (seed: ReadonlyArray<BankAccountRecord> = []) =>
    Layer.effect(BankAccountRepository, bookkeepingTable('bookkeeping_bank_accounts', { seed }))

  /** `seed`로 시작하는 메모리 저장소입니다. */
  static readonly layerMemory = (seed: ReadonlyArray<BankAccountRecord> = []) =>
    BankAccountRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}

/** 하루 마감 잔액 저장소입니다. ID는 `<계좌 ID>:<날짜>`로 정해져 있어 같은 날 잔액은 한 행입니다. */
export class BalanceSnapshotRepository extends Context.Service<
  BalanceSnapshotRepository,
  Table<BalanceSnapshotRecord>
>()('semu/bookkeeping/BalanceSnapshotRepository') {
  /** `bookkeeping_balance_snapshots` 표에 둡니다. 표가 비어 있으면 `seed`로 시작합니다. */
  static readonly layer = (seed: ReadonlyArray<BalanceSnapshotRecord> = []) =>
    Layer.effect(BalanceSnapshotRepository, bookkeepingTable('bookkeeping_balance_snapshots', { seed }))

  /** `seed`로 시작하는 메모리 저장소입니다. */
  static readonly layerMemory = (seed: ReadonlyArray<BalanceSnapshotRecord> = []) =>
    BalanceSnapshotRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}

/** 입출금 거래 저장소입니다. */
export class BankTransactionRepository extends Context.Service<
  BankTransactionRepository,
  Table<BankTransactionRecord>
>()('semu/bookkeeping/BankTransactionRepository') {
  /** `bookkeeping_bank_transactions` 표에 둡니다. 표가 비어 있으면 `seed`로 시작합니다. */
  static readonly layer = (seed: ReadonlyArray<BankTransactionRecord> = []) =>
    Layer.effect(BankTransactionRepository, bookkeepingTable('bookkeeping_bank_transactions', { seed }))

  /** `seed`로 시작하는 메모리 저장소입니다. */
  static readonly layerMemory = (seed: ReadonlyArray<BankTransactionRecord> = []) =>
    BankTransactionRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}

/** 입출금–증빙 연결 저장소입니다. */
export class SettlementLinkRepository extends Context.Service<SettlementLinkRepository, Table<SettlementLinkRecord>>()(
  'semu/bookkeeping/SettlementLinkRepository',
) {
  /** `bookkeeping_settlement_links` 표에 둡니다. 표가 비어 있으면 `seed`로 시작합니다. */
  static readonly layer = (seed: ReadonlyArray<SettlementLinkRecord> = []) =>
    Layer.effect(SettlementLinkRepository, bookkeepingTable('bookkeeping_settlement_links', { seed }))

  /** `seed`로 시작하는 메모리 저장소입니다. */
  static readonly layerMemory = (seed: ReadonlyArray<SettlementLinkRecord> = []) =>
    SettlementLinkRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}

/** 거래처 저장소입니다. */
export class PartnerRepository extends Context.Service<PartnerRepository, Table<PartnerRecord>>()(
  'semu/bookkeeping/PartnerRepository',
) {
  /** `bookkeeping_partners` 표에 둡니다. 표가 비어 있으면 `seed`로 시작합니다. */
  static readonly layer = (seed: ReadonlyArray<PartnerRecord> = []) =>
    Layer.effect(PartnerRepository, bookkeepingTable('bookkeeping_partners', { seed }))

  /** `seed`로 시작하는 메모리 저장소입니다. */
  static readonly layerMemory = (seed: ReadonlyArray<PartnerRecord> = []) =>
    PartnerRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}

/** 사업자 상태조회 캐시입니다. 행은 회사와 상관없이 모두가 봅니다. */
export class BusinessStatusCacheRepository extends Context.Service<
  BusinessStatusCacheRepository,
  Table<BusinessStatusCacheRecord>
>()('semu/bookkeeping/BusinessStatusCacheRepository') {
  /** `bookkeeping_business_status_cache` 표에 둡니다. 표가 비어 있으면 `seed`로 시작합니다. */
  static readonly layer = (seed: ReadonlyArray<BusinessStatusCacheRecord> = []) =>
    Layer.effect(BusinessStatusCacheRepository, bookkeepingTable('bookkeeping_business_status_cache', { seed }))

  /** `seed`로 시작하는 메모리 저장소입니다. */
  static readonly layerMemory = (seed: ReadonlyArray<BusinessStatusCacheRecord> = []) =>
    BusinessStatusCacheRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}

/** 거래명세서 저장소입니다. */
export class SalesTransactionRepository extends Context.Service<
  SalesTransactionRepository,
  Table<SalesTransactionRecord>
>()('semu/bookkeeping/SalesTransactionRepository') {
  /** `bookkeeping_sales_transactions` 표에 둡니다. 표가 비어 있으면 `seed`로 시작합니다. */
  static readonly layer = (seed: ReadonlyArray<SalesTransactionRecord> = []) =>
    Layer.effect(SalesTransactionRepository, bookkeepingTable('bookkeeping_sales_transactions', { seed }))

  /** `seed`로 시작하는 메모리 저장소입니다. */
  static readonly layerMemory = (seed: ReadonlyArray<SalesTransactionRecord> = []) =>
    SalesTransactionRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}

/** 세금계산서 발급 건 저장소입니다. */
export class TaxInvoiceRepository extends Context.Service<TaxInvoiceRepository, Table<TaxInvoiceRecord>>()(
  'semu/bookkeeping/TaxInvoiceRepository',
) {
  /** `bookkeeping_tax_invoices` 표에 둡니다. 표가 비어 있으면 `seed`로 시작합니다. */
  static readonly layer = (seed: ReadonlyArray<TaxInvoiceRecord> = []) =>
    Layer.effect(TaxInvoiceRepository, bookkeepingTable('bookkeeping_tax_invoices', { seed }))

  /** `seed`로 시작하는 메모리 저장소입니다. */
  static readonly layerMemory = (seed: ReadonlyArray<TaxInvoiceRecord> = []) =>
    TaxInvoiceRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}

/** 지로 고지서 저장소입니다. */
export class GiroRepository extends Context.Service<GiroRepository, Table<GiroRecord>>()(
  'semu/bookkeeping/GiroRepository',
) {
  /** `bookkeeping_giros` 표에 둡니다. 표가 비어 있으면 `seed`로 시작합니다. */
  static readonly layer = (seed: ReadonlyArray<GiroRecord> = []) =>
    Layer.effect(GiroRepository, bookkeepingTable('bookkeeping_giros', { seed }))

  /** `seed`로 시작하는 메모리 저장소입니다. */
  static readonly layerMemory = (seed: ReadonlyArray<GiroRecord> = []) =>
    GiroRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}

/** 지로 납부 시도 저장소입니다. ID가 멱등 키입니다. */
export class GiroPaymentRepository extends Context.Service<GiroPaymentRepository, Table<GiroPaymentRecord>>()(
  'semu/bookkeeping/GiroPaymentRepository',
) {
  /** `bookkeeping_giro_payments` 표에 둡니다. 표가 비어 있으면 `seed`로 시작합니다. */
  static readonly layer = (seed: ReadonlyArray<GiroPaymentRecord> = []) =>
    Layer.effect(GiroPaymentRepository, bookkeepingTable('bookkeeping_giro_payments', { seed }))

  /** `seed`로 시작하는 메모리 저장소입니다. */
  static readonly layerMemory = (seed: ReadonlyArray<GiroPaymentRecord> = []) =>
    GiroPaymentRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}

/** 저장소 전체입니다. 표는 `TableFactory`(메모리 또는 SQLite)에 둡니다. 시드 없이 비어 있고, 계정과목만 기본 체계를 봅니다. */
export const BookkeepingRepositoriesLive = Layer.mergeAll(
  AccountTitleRepository.layer(),
  EvidenceRepository.layer(),
  ClassificationRuleRepository.layer(),
  BankAccountRepository.layer(),
  BalanceSnapshotRepository.layer(),
  BankTransactionRepository.layer(),
  SettlementLinkRepository.layer(),
  PartnerRepository.layer(),
  BusinessStatusCacheRepository.layer(),
  SalesTransactionRepository.layer(),
  TaxInvoiceRepository.layer(),
  GiroRepository.layer(),
  GiroPaymentRepository.layer(),
)

/** {@link BookkeepingRepositoriesLive}를 메모리 표로 채웁니다. */
export const BookkeepingRepositoriesMemory = BookkeepingRepositoriesLive.pipe(Layer.provide(TableFactory.layerMemory))
