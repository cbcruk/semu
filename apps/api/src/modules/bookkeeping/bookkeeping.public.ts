/**
 * Bookkeeping이 다른 컨텍스트에 여는 공개 계약입니다. 다른 컨텍스트는 이 파일만 import합니다.
 *
 * - Integrations → {@link ScrapedRecordIngestion}: 스크래핑 결과(증빙·카드 승인·계좌·거래·잔액·지로)를 넘깁니다
 * - Tax → {@link VatEvidenceQuery}: 예상 부가세 계산에 쓸 기간 증빙을 읽습니다
 *
 * Bookkeeping이 다른 컨텍스트에 기대는 포트(`ports/`)는 그 컨텍스트가 구현해 넣습니다.
 */
export { ScrapedRecordIngestion, accountNumberDigest } from './ingestion/scraped-record-ingestion.ts'
export type {
  IngestionRejection,
  IngestionResult,
  ScrapedBankAccount,
  ScrapedBankBalance,
  ScrapedBankTransaction,
  ScrapedCardApproval,
  ScrapedEvidence,
  ScrapedGiroBills,
  ScrapedRecord,
} from './ingestion/scraped-record.types.ts'
export type { ScrapedGiroBill } from './giros/giro.types.ts'
export { VatEvidenceQuery } from './vat/vat-evidence-query.ts'
export type { VatEvidence, VatPurchaseEvidence, VatSalesEvidence } from './vat/vat-evidence-query.ts'
export { BusinessStatusLookup } from './ports/business-status-lookup.ts'
export type { BusinessStatus, BusinessStatusAnswer } from './ports/business-status-lookup.ts'
export { HometaxInvoiceIssuer } from './ports/hometax-invoice-issuer.ts'
export type { InvoiceIssueRequest, InvoiceIssueResult } from './ports/hometax-invoice-issuer.ts'
export { GiroPaymentGateway } from './ports/giro-payment-gateway.ts'
export type { GiroPaymentRequest, GiroPaymentResult } from './ports/giro-payment-gateway.ts'
export { LaborCostSource } from './ports/labor-cost-source.ts'
export type { LaborCostByIncomeType, LaborCostMonth } from './ports/labor-cost-source.ts'
export { VatEstimateSource } from './ports/vat-estimate-source.ts'
export type { VatEstimateSummary } from './ports/vat-estimate-source.ts'
export { AccountNumberCipher } from './ports/account-number-cipher.ts'
