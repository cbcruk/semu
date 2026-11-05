import { Context, Layer } from 'effect'
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
import { memoryTable } from './memory-table.ts'
import type { Table } from './memory-table.ts'

/** 계정과목 저장소입니다. 메모리 구현은 기본 계정과목으로 시작합니다. */
export class AccountTitleRepository extends Context.Service<AccountTitleRepository, Table<AccountTitleRecord>>()(
  'semu/bookkeeping/AccountTitleRepository',
) {
  /** 기본 계정과목과 `seed`로 시작하는 메모리 저장소입니다. */
  static readonly layerMemory = (seed: ReadonlyArray<AccountTitleRecord> = []) =>
    Layer.effect(AccountTitleRepository, memoryTable([...SYSTEM_ACCOUNT_TITLES, ...seed]))
}

/** 매출·매입 증빙 저장소입니다. */
export class EvidenceRepository extends Context.Service<EvidenceRepository, Table<EvidenceRecord>>()(
  'semu/bookkeeping/EvidenceRepository',
) {
  /** `seed`로 시작하는 메모리 저장소입니다. */
  static readonly layerMemory = (seed: ReadonlyArray<EvidenceRecord> = []) =>
    Layer.effect(EvidenceRepository, memoryTable(seed))
}

/** 분류 규칙 저장소입니다. */
export class ClassificationRuleRepository extends Context.Service<
  ClassificationRuleRepository,
  Table<ClassificationRuleRecord>
>()('semu/bookkeeping/ClassificationRuleRepository') {
  /** `seed`로 시작하는 메모리 저장소입니다. */
  static readonly layerMemory = (seed: ReadonlyArray<ClassificationRuleRecord> = []) =>
    Layer.effect(ClassificationRuleRepository, memoryTable(seed))
}

/** 은행 계좌 저장소입니다. */
export class BankAccountRepository extends Context.Service<BankAccountRepository, Table<BankAccountRecord>>()(
  'semu/bookkeeping/BankAccountRepository',
) {
  /** `seed`로 시작하는 메모리 저장소입니다. */
  static readonly layerMemory = (seed: ReadonlyArray<BankAccountRecord> = []) =>
    Layer.effect(BankAccountRepository, memoryTable(seed))
}

/** 하루 마감 잔액 저장소입니다. */
export class BalanceSnapshotRepository extends Context.Service<
  BalanceSnapshotRepository,
  Table<BalanceSnapshotRecord>
>()('semu/bookkeeping/BalanceSnapshotRepository') {
  /** `seed`로 시작하는 메모리 저장소입니다. */
  static readonly layerMemory = (seed: ReadonlyArray<BalanceSnapshotRecord> = []) =>
    Layer.effect(BalanceSnapshotRepository, memoryTable(seed))
}

/** 입출금 거래 저장소입니다. */
export class BankTransactionRepository extends Context.Service<
  BankTransactionRepository,
  Table<BankTransactionRecord>
>()('semu/bookkeeping/BankTransactionRepository') {
  /** `seed`로 시작하는 메모리 저장소입니다. */
  static readonly layerMemory = (seed: ReadonlyArray<BankTransactionRecord> = []) =>
    Layer.effect(BankTransactionRepository, memoryTable(seed))
}

/** 입출금–증빙 연결 저장소입니다. */
export class SettlementLinkRepository extends Context.Service<SettlementLinkRepository, Table<SettlementLinkRecord>>()(
  'semu/bookkeeping/SettlementLinkRepository',
) {
  /** `seed`로 시작하는 메모리 저장소입니다. */
  static readonly layerMemory = (seed: ReadonlyArray<SettlementLinkRecord> = []) =>
    Layer.effect(SettlementLinkRepository, memoryTable(seed))
}

/** 거래처 저장소입니다. */
export class PartnerRepository extends Context.Service<PartnerRepository, Table<PartnerRecord>>()(
  'semu/bookkeeping/PartnerRepository',
) {
  /** `seed`로 시작하는 메모리 저장소입니다. */
  static readonly layerMemory = (seed: ReadonlyArray<PartnerRecord> = []) =>
    Layer.effect(PartnerRepository, memoryTable(seed))
}

/** 사업자 상태조회 캐시입니다. 행은 회사와 상관없이 모두가 봅니다. */
export class BusinessStatusCacheRepository extends Context.Service<
  BusinessStatusCacheRepository,
  Table<BusinessStatusCacheRecord>
>()('semu/bookkeeping/BusinessStatusCacheRepository') {
  /** `seed`로 시작하는 메모리 저장소입니다. */
  static readonly layerMemory = (seed: ReadonlyArray<BusinessStatusCacheRecord> = []) =>
    Layer.effect(BusinessStatusCacheRepository, memoryTable(seed))
}

/** 거래명세서 저장소입니다. */
export class SalesTransactionRepository extends Context.Service<
  SalesTransactionRepository,
  Table<SalesTransactionRecord>
>()('semu/bookkeeping/SalesTransactionRepository') {
  /** `seed`로 시작하는 메모리 저장소입니다. */
  static readonly layerMemory = (seed: ReadonlyArray<SalesTransactionRecord> = []) =>
    Layer.effect(SalesTransactionRepository, memoryTable(seed))
}

/** 세금계산서 발급 건 저장소입니다. */
export class TaxInvoiceRepository extends Context.Service<TaxInvoiceRepository, Table<TaxInvoiceRecord>>()(
  'semu/bookkeeping/TaxInvoiceRepository',
) {
  /** `seed`로 시작하는 메모리 저장소입니다. */
  static readonly layerMemory = (seed: ReadonlyArray<TaxInvoiceRecord> = []) =>
    Layer.effect(TaxInvoiceRepository, memoryTable(seed))
}

/** 지로 고지서 저장소입니다. */
export class GiroRepository extends Context.Service<GiroRepository, Table<GiroRecord>>()(
  'semu/bookkeeping/GiroRepository',
) {
  /** `seed`로 시작하는 메모리 저장소입니다. */
  static readonly layerMemory = (seed: ReadonlyArray<GiroRecord> = []) =>
    Layer.effect(GiroRepository, memoryTable(seed))
}

/** 지로 납부 시도 저장소입니다. ID가 멱등 키입니다. */
export class GiroPaymentRepository extends Context.Service<GiroPaymentRepository, Table<GiroPaymentRecord>>()(
  'semu/bookkeeping/GiroPaymentRepository',
) {
  /** `seed`로 시작하는 메모리 저장소입니다. */
  static readonly layerMemory = (seed: ReadonlyArray<GiroPaymentRecord> = []) =>
    Layer.effect(GiroPaymentRepository, memoryTable(seed))
}

/** 메모리 저장소 전체입니다. 시드 없이 비어 있고, 계정과목만 기본 체계로 시작합니다. */
export const BookkeepingRepositoriesMemory = Layer.mergeAll(
  AccountTitleRepository.layerMemory(),
  EvidenceRepository.layerMemory(),
  ClassificationRuleRepository.layerMemory(),
  BankAccountRepository.layerMemory(),
  BalanceSnapshotRepository.layerMemory(),
  BankTransactionRepository.layerMemory(),
  SettlementLinkRepository.layerMemory(),
  PartnerRepository.layerMemory(),
  BusinessStatusCacheRepository.layerMemory(),
  SalesTransactionRepository.layerMemory(),
  TaxInvoiceRepository.layerMemory(),
  GiroRepository.layerMemory(),
  GiroPaymentRepository.layerMemory(),
)
