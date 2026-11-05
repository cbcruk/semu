import type { Id } from '../../shared/ids/ids.types.ts'
import { TEST_COMPANY_ID } from '../identity-access/testing.ts'
import type { TaxProfile } from './calendar/tax-profiles.ts'
import type { FilingRecord } from './filings/filing.types.ts'
import { requirementTemplate } from './filings/filing-requirements.ts'
import type { PurchaseEvidence, SalesEvidence } from './vat-estimates/vat-estimate.types.ts'

const DEMO_TIME = '2026-11-01T00:00:00.000Z'

/**
 * 신고 건 레코드를 만듭니다. 주지 않은 값은 비어 있는 `SCHEDULED` 신고 건이고, 체크리스트는 세목 기본값입니다.
 *
 * 데모 시드와 테스트가 함께 씁니다.
 */
export function filingRecord(
  fields: Pick<FilingRecord, 'id' | 'taxType' | 'kind' | 'periodKey' | 'periodStart' | 'periodEnd'> &
    Partial<FilingRecord>,
): FilingRecord {
  return {
    companyId: TEST_COMPANY_ID,
    revision: 0,
    statutoryDue: null,
    dueDate: null,
    paymentDue: null,
    submitDue: null,
    status: 'SCHEDULED',
    payableAmount: null,
    settlement: null,
    paidOn: null,
    ledgerUploadedAt: null,
    ledgerConfirmedAt: null,
    ledgerDisputeCount: 0,
    paymentSlipSentAt: null,
    requirements: requirementTemplate(fields.taxType, fields.kind, true).map((template) => ({
      code: template.code,
      response: 'PENDING',
      autoLinked: template.autoLinked,
      note: null,
      fileIds: [],
      updatedBy: null,
      updatedAt: null,
    })),
    documents: [],
    history: [],
    version: 1,
    createdAt: DEMO_TIME,
    updatedAt: DEMO_TIME,
    ...fields,
  }
}

/** 데모 회사의 세무 프로필입니다. 12월 결산 법인, 매월 원천세, 예정 신고입니다. */
export const DEMO_TAX_PROFILE: TaxProfile = {
  companyId: TEST_COMPANY_ID,
  businessType: 'CORPORATION',
  fiscalYearEndMonth: 12,
  withholdingCycle: 'MONTHLY',
  vatPreliminaryMode: 'FILING',
  sincereFilingTarget: false,
  plans: ['TAXATION', 'PAYROLL'],
  taxableCardRatioPpm: 1_000_000,
}

/** 데모 신고 건입니다. 10월분 원천세는 자료 요청 중, 2기 확정 부가세는 예정 상태입니다. */
export const DEMO_FILINGS: ReadonlyArray<FilingRecord> = [
  filingRecord({
    id: 'fil_01JBQ0000000000000000000D1' as Id<'filing'>,
    taxType: 'WITHHOLDING_TAX',
    kind: 'MONTHLY',
    periodKey: '2026-10',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    statutoryDue: '2026-11-10',
    dueDate: '2026-11-10',
    paymentDue: '2026-11-10',
    submitDue: '2026-11-06',
    status: 'REQUESTED',
  }),
  filingRecord({
    id: 'fil_01JBQ0000000000000000000D2' as Id<'filing'>,
    taxType: 'VAT',
    kind: 'FINAL',
    periodKey: '2026-H2',
    periodStart: '2026-07-01',
    periodEnd: '2026-12-31',
    statutoryDue: '2027-01-25',
    dueDate: '2027-01-25',
    paymentDue: '2027-01-25',
  }),
]

/** 2026–2027년 기한을 미루는 쉬는 날입니다. 대체공휴일과 근로자의 날을 넣었습니다. */
export const DEMO_HOLIDAYS: ReadonlyArray<string> = [
  '2026-01-01',
  '2026-02-16',
  '2026-02-17',
  '2026-02-18',
  '2026-03-01',
  '2026-03-02',
  '2026-05-01',
  '2026-05-05',
  '2026-05-24',
  '2026-05-25',
  '2026-06-03',
  '2026-06-06',
  '2026-08-15',
  '2026-08-17',
  '2026-09-24',
  '2026-09-25',
  '2026-09-26',
  '2026-10-03',
  '2026-10-05',
  '2026-10-09',
  '2026-12-25',
  '2027-01-01',
]

/** 데모 증빙입니다. 4분기 카드 매출 한 건과 공제 매입 한 건입니다. */
export const DEMO_VAT_EVIDENCE: { sales: ReadonlyArray<SalesEvidence>; purchases: ReadonlyArray<PurchaseEvidence> } = {
  sales: [
    {
      id: 'demo-sale-1',
      source: 'CARD',
      issuedOn: '2026-10-15',
      totalAmount: 1_100_000,
      vatAmount: null,
      dedupeGroup: null,
      syncedAt: DEMO_TIME,
    },
  ],
  purchases: [
    {
      id: 'demo-purchase-1',
      source: 'TAX_INVOICE',
      issuedOn: '2026-10-20',
      vatAmount: 30_000,
      deductible: true,
      syncedAt: DEMO_TIME,
    },
  ],
}
