/**
 * 다른 컨텍스트가 Integrations에서 가져다 쓰는 것입니다. 이 파일 밖의 모듈은 내부 구현이라 직접 import하지 않습니다.
 *
 * - Bookkeeping은 {@link ScrapedRecordSink}를 구현해 수집 레코드를 받습니다
 * - Identity & Access는 {@link CompanyProfiles}를 구현해 사업자번호·대표자 이름을 줍니다
 * - Bookkeeping은 {@link BusinessStatusClient}(사업자 상태조회), {@link HometaxInvoiceClient}(세금계산서 발급),
 *   {@link GiroPaymentClient}(지로 납부)를 `app.ts`의 어댑터로 씁니다
 * - Identity & Access는 회사 등록 전 폐업 확인에 {@link BusinessStatusClient}를 씁니다(`wiring/identity-access-integrations.ts`)
 */
export { CompanyProfiles } from './ports/company-profiles.ts'
export type { CertificateCompany } from './certificates/certificate-eligibility.types.ts'
export { ScrapedRecordSink } from './ports/scraped-record-sink.ts'
export type { ScrapedBatch, ScrapedRecord, ScrapedRecordKind } from './ports/scraped-record-sink.ts'
export type { InstitutionType } from './institutions/institution.ts'
export { BusinessStatusClient } from './ports/business-status-client.ts'
export type { BusinessStatusCode, BusinessStatusResult, TaxType } from './ports/business-status-client.ts'
export { HometaxInvoiceClient } from './ports/hometax-invoice-client.ts'
export type { HometaxInvoiceRequest, HometaxInvoiceResult } from './ports/hometax-invoice-client.ts'
export { GiroPaymentClient } from './ports/giro-payment-client.ts'
export type { GiroPaymentOrder, GiroPaymentOutcome } from './ports/giro-payment-client.ts'
