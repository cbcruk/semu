import { Layer } from 'effect'
import { HrDirectoryLive } from '../modules/hr/hr.public.ts'
import { PayrollPublicLive } from '../modules/payroll/payroll.layer.ts'
import { TaxPublicLive } from '../modules/tax/tax.layer.ts'
import { BillingPublicHolidaysFromCalendar } from './billing-public-holidays.ts'
import { BookkeepingIntegrationsLive } from './bookkeeping-integrations.ts'
import { BookkeepingLaborCostFromPayroll } from './bookkeeping-payroll.ts'
import { BookkeepingVatEstimateFromTax } from './bookkeeping-tax.ts'
import { IdentityAccessAgencyWorkloadFromTax } from './identity-access-tax.ts'
import { IntegrationsRecordSinkFromBookkeeping } from './integrations-bookkeeping.ts'
import { IntegrationsCompanyProfilesFromIdentityAccess } from './integrations-identity-access.ts'
import { PayrollEmployeeDirectoryFromHr } from './payroll-hr.ts'
import { PayrollEventsToTax, PayrollWithholdingFilingLockFromTax } from './payroll-tax.ts'
import { TaxVatEvidenceFromBookkeeping } from './tax-bookkeeping.ts'
import { TaxProfilesFromIdentityAccess } from './tax-identity-access.ts'
import { TaxPayrollLedgersFromPayroll, TaxWithholdingTotalsFromPayroll } from './tax-payroll.ts'
import { TaxPublicHolidaysFromCalendar } from './tax-public-holidays.ts'

/** 컨텍스트 저장소와 공유 참조데이터만 있으면 만들 수 있는 어댑터입니다. */
const StoreBackedAdapters = Layer.mergeAll(
  PayrollEmployeeDirectoryFromHr,
  TaxVatEvidenceFromBookkeeping,
  TaxProfilesFromIdentityAccess,
  TaxPublicHolidaysFromCalendar,
  BillingPublicHolidaysFromCalendar,
  BookkeepingIntegrationsLive,
  IntegrationsRecordSinkFromBookkeeping,
  IntegrationsCompanyProfilesFromIdentityAccess,
)

/** Payroll 공개 서비스로 만드는 어댑터입니다. */
const PayrollBackedAdapters = Layer.mergeAll(
  TaxPayrollLedgersFromPayroll,
  TaxWithholdingTotalsFromPayroll,
  BookkeepingLaborCostFromPayroll,
)

/** Tax 공개 서비스로 만드는 어댑터입니다. */
const TaxBackedAdapters = Layer.mergeAll(
  PayrollWithholdingFilingLockFromTax,
  PayrollEventsToTax,
  BookkeepingVatEstimateFromTax,
  IdentityAccessAgencyWorkloadFromTax,
)

/**
 * 컨텍스트 사이 포트를 제공하는 쪽의 공개 서비스로 채우는 어댑터 전체입니다. 각 컨텍스트의 저장소는 호출하는 쪽이 넣습니다.
 *
 * | 쓰는 쪽 포트 | 제공하는 쪽 | 어댑터 |
 * |---|---|---|
 * | Payroll `PayrollEmployeeDirectory` | HR `HrDirectory` | `payroll-hr.ts` |
 * | Payroll `WithholdingFilingLock`, `PayrollEventPublisher` | Tax `WithholdingFilingLock`, `PayrollLedgerSync` | `payroll-tax.ts` |
 * | Tax `PayrollLedgers`, `WithholdingTotals` | Payroll `PayrollLedgerSummary`, `PayrollWithholdingTotals` | `tax-payroll.ts` |
 * | Tax `VatEvidence` | Bookkeeping `VatEvidenceQuery` | `tax-bookkeeping.ts` |
 * | Tax `TaxProfiles` | Identity & Access `CompanyDirectory`, Billing `CompanyPlans` | `tax-identity-access.ts` |
 * | Tax·Billing `PublicHolidays` | 공유 `PublicHolidayCalendar` | `tax-public-holidays.ts`, `billing-public-holidays.ts` |
 * | Bookkeeping `VatEstimateSource` | Tax `VatEstimateQuery` | `bookkeeping-tax.ts` |
 * | Bookkeeping `LaborCostSource` | Payroll `PayrollLaborCost` | `bookkeeping-payroll.ts` |
 * | Bookkeeping `BusinessStatusLookup`, `HometaxInvoiceIssuer`, `GiroPaymentGateway` | Integrations `BusinessStatusClient`, `HometaxInvoiceClient`, `GiroPaymentClient` | `bookkeeping-integrations.ts` |
 * | Integrations `ScrapedRecordSink` | Bookkeeping `ScrapedRecordIngestion` | `integrations-bookkeeping.ts` |
 * | Integrations `CompanyProfiles` | Identity & Access `CompanyDirectory` | `integrations-identity-access.ts` |
 * | Identity & Access `AgencyWorkload` | Tax `AgencyWorkloadQuery` | `identity-access-tax.ts` |
 * | Documents `HrDirectory` | HR `HrDirectoryLive` | 어댑터 없이 HR 공개 조회를 그대로 씁니다 |
 *
 * 만드는 순서는 저장소 → HR 공개 조회 → 저장소 어댑터 → Payroll 공개 서비스 → Payroll 어댑터 → Tax 공개 서비스 → Tax 어댑터입니다.
 * 모든 어댑터와 공개 서비스가 호출하는 쪽이 넣은 저장소 인스턴스 하나를 함께 쓰므로, 한 컨텍스트에 쓴 값이 다른 컨텍스트에 바로 보입니다.
 * 만든 공개 서비스(`HrDirectory`, `PayrollLedgerSummary`, `PayrollWithholdingTotals`, `PayrollLaborCost`, `WithholdingFilingLock`, `PayrollLedgerSync`,
 * `VatEstimateQuery`, `AgencyWorkloadQuery`)도 함께 내보냅니다.
 */
export const WiringLive = TaxBackedAdapters.pipe(
  Layer.provideMerge(TaxPublicLive),
  Layer.provideMerge(PayrollBackedAdapters),
  Layer.provideMerge(PayrollPublicLive),
  Layer.provideMerge(StoreBackedAdapters),
  Layer.provideMerge(HrDirectoryLive),
)
