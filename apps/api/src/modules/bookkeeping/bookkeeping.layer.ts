import { Layer } from 'effect'
import { AccountTitleService } from './account-titles/account-title-service.ts'
import { AccountTitlesHttpLive } from './account-titles/account-titles.http.ts'
import { BankService } from './bank/bank-service.ts'
import { BankHttpLive } from './bank/bank.http.ts'
import { ClassificationRuleService } from './classification/classification-rule-service.ts'
import { ClassificationRulesHttpLive } from './classification/classification-rules.http.ts'
import { Classifier } from './classification/classifier.ts'
import { BookkeepingRepositoriesMemory } from './common/repositories.ts'
import { seedDemo } from './demo-seed.ts'
import { EvidenceService } from './evidence/evidence-service.ts'
import { EvidenceHttpLive } from './evidence/evidence.http.ts'
import { GiroService } from './giros/giro-service.ts'
import { GirosHttpLive } from './giros/giros.http.ts'
import { ScrapedRecordIngestion } from './ingestion/scraped-record-ingestion.ts'
import { BusinessStatusService, PartnerService } from './partners/partner-service.ts'
import { PartnersHttpLive } from './partners/partners.http.ts'
import { AccountNumberCipher } from './ports/account-number-cipher.ts'
import { BusinessStatusLookup } from './ports/business-status-lookup.ts'
import { GiroPaymentGateway } from './ports/giro-payment-gateway.ts'
import { HometaxInvoiceIssuer } from './ports/hometax-invoice-issuer.ts'
import { LaborCostSource } from './ports/labor-cost-source.ts'
import { VatEstimateSource } from './ports/vat-estimate-source.ts'
import { ReportService } from './reports/report-service.ts'
import { ReportsHttpLive } from './reports/reports.http.ts'
import { SalesTransactionService } from './sales-transactions/sales-transaction-service.ts'
import { SalesTransactionsHttpLive } from './sales-transactions/sales-transactions.http.ts'
import { VatEvidenceQuery } from './vat/vat-evidence-query.ts'

const Services = Layer.mergeAll(
  EvidenceService.layer,
  AccountTitleService.layer,
  ClassificationRuleService.layer,
  BankService.layer,
  PartnerService.layer,
  SalesTransactionService.layer,
  GiroService.layer,
  ReportService.layer,
).pipe(Layer.provideMerge(BusinessStatusService.layer), Layer.provide(Classifier.layer))

/** 증빙·계정과목·자동분류·입출금·거래처·세금계산서·지로·결산 보고서 컨텍스트의 핸들러 전체입니다. 저장소와 외부 연동 포트는 호출하는 쪽이 넣습니다. */
export const BookkeepingHttpLive = Layer.mergeAll(
  EvidenceHttpLive,
  AccountTitlesHttpLive,
  ClassificationRulesHttpLive,
  BankHttpLive,
  PartnersHttpLive,
  SalesTransactionsHttpLive,
  GirosHttpLive,
  ReportsHttpLive,
).pipe(Layer.provide(Services))

/**
 * 다른 컨텍스트에 여는 서비스(`bookkeeping.public.ts`)입니다. 수집 레코드 수신과 부가세 증빙 조회입니다.
 *
 * 저장소와 `AccountNumberCipher`는 호출하는 쪽이 넣습니다.
 */
export const BookkeepingPublicLive = Layer.mergeAll(ScrapedRecordIngestion.layer, VatEvidenceQuery.layer).pipe(
  Layer.provide(Classifier.layer),
)

const MemoryAdapters = Layer.mergeAll(
  BookkeepingRepositoriesMemory,
  AccountNumberCipher.layerFake,
  BusinessStatusLookup.layerFake,
  HometaxInvoiceIssuer.layerFake,
  GiroPaymentGateway.layerFake,
  VatEstimateSource.layerFake(1_500_000),
  LaborCostSource.layerFake([
    {
      month: '2026-10',
      amounts: { wageAmount: 8_000_000, dailyWageAmount: 0, businessIncomeAmount: 0, otherIncomeAmount: 0 },
      paidHeadcount: { wageAmount: 2, dailyWageAmount: 0, businessIncomeAmount: 0, otherIncomeAmount: 0 },
      employedCount: 2,
      joinedCount: 0,
      leftCount: 0,
    },
  ]),
)

const DemoSeedLive = Layer.effectDiscard(seedDemo).pipe(Layer.provide(BookkeepingPublicLive))

/**
 * 증빙·계정과목·자동분류·입출금·거래처·세금계산서·지로·결산 보고서 컨텍스트의 저장소·외부 연동을 메모리 구현과 결정적인 가짜로 채웁니다. 로컬 개발과 테스트에 씁니다.
 *
 * 공개 서비스(`BookkeepingPublicLive`)도 함께 내보내고, 데모 회사에 현행 데모 숫자를 넣어 둡니다.
 */
export const BookkeepingMemoryLive = Layer.mergeAll(BookkeepingPublicLive, DemoSeedLive).pipe(
  Layer.provideMerge(MemoryAdapters),
)
