import { Effect } from 'effect'
import type { Id } from '../../shared/ids/ids.types.ts'
import { systemAccountTitleIdOf } from './account-titles/system-account-titles.ts'
import type { ClassificationRuleRecord } from './classification/classification-rule.types.ts'
import {
  BankTransactionRepository,
  ClassificationRuleRepository,
  EvidenceRepository,
  GiroRepository,
  PartnerRepository,
  SettlementLinkRepository,
} from './common/repositories.ts'
import type { EvidenceRecord } from './evidence/evidence.types.ts'
import type { GiroRecord } from './giros/giro.types.ts'
import { ScrapedRecordIngestion } from './ingestion/scraped-record-ingestion.ts'
import type { ScrapedRecord } from './ingestion/scraped-record.types.ts'
import type { PartnerRecord } from './partners/partner.types.ts'

/** 데모 회사입니다. 테스트 회사(`identity-access/testing.ts`)와 같은 ID라 테스트가 데모 숫자를 그대로 확인합니다. */
export const DEMO_COMPANY_ID = 'cmp_01JBQ000000000000000000001' as Id<'company'>

const SEEDED_AT = '2026-11-01T06:00:00+09:00'

/** 데모 거래처 ID입니다. */
export const DEMO_PARTNERS = {
  ecopro: 'ptn_01JBQ000000000000000000001' as Id<'partner'>,
  office: 'ptn_01JBQ000000000000000000002' as Id<'partner'>,
  landlord: 'ptn_01JBQ000000000000000000003' as Id<'partner'>,
}

function partner(id: Id<'partner'>, name: string, businessNumber: string, role: 'SALES' | 'PURCHASE'): PartnerRecord {
  return {
    id,
    companyId: DEMO_COMPANY_ID,
    type: 'CORPORATE_BUSINESS',
    roles: [role],
    name,
    representativeName: '대표자',
    businessNumber,
    businessStatus: 'REGISTERED',
    businessType: null,
    businessItem: null,
    address: null,
    phoneNumber: null,
    memo: null,
    bankAccounts: [],
    contacts: [],
    createdAt: SEEDED_AT,
    deletedAt: null,
    version: 1,
  }
}

function rule(
  n: number,
  scope: ClassificationRuleRecord['scope'],
  name: string,
  conditions: ClassificationRuleRecord['conditions'],
  account: string,
  partnerId: Id<'partner'> | null = null,
  source: string | null = null,
): ClassificationRuleRecord {
  return {
    id: `rul_01JBQ00000000000000000000${n}` as Id<'classificationRule'>,
    companyId: DEMO_COMPANY_ID,
    scope,
    source,
    name,
    conditions,
    resultAccountTitleId: systemAccountTitleIdOf(account),
    resultPartnerId: partnerId,
    priority: n,
    status: 'ACTIVE',
    createdAt: SEEDED_AT,
    updatedAt: SEEDED_AT,
    version: 1,
  }
}

const RULES: ClassificationRuleRecord[] = [
  rule(
    1,
    'BANK',
    '에코프로 입금',
    [{ field: 'SUMMARY', operator: 'CONTAINS', values: ['에코프로'] }],
    'trade.sales_in.partner',
    DEMO_PARTNERS.ecopro,
  ),
  rule(
    2,
    'BANK',
    '임대료',
    [{ field: 'SUMMARY', operator: 'CONTAINS', values: ['임대료'] }],
    'sga.rent',
    DEMO_PARTNERS.landlord,
  ),
  rule(3, 'BANK', '급여', [{ field: 'SUMMARY', operator: 'CONTAINS', values: ['급여'] }], 'sga.salary'),
  rule(
    4,
    'PURCHASE',
    '소액 카드',
    [{ field: 'SUPPLY_AMOUNT', operator: 'LTE', max: 500_000 }],
    'sga.welfare',
    null,
    'CARD',
  ),
  rule(5, 'SALES', '카드 매출', [{ field: 'TOTAL_AMOUNT', operator: 'GTE', min: 0 }], 'sales.revenue', null, 'CARD'),
]

const MAIN = { bankCode: '004', accountNumber: '123-456-789012' }
const SUB = { bankCode: '088', accountNumber: '110-222-333444' }

function tx(
  account: typeof MAIN,
  key: string,
  at: string,
  amount: number,
  balanceAfter: number,
  summary: string,
): ScrapedRecord {
  return { type: 'BANK_TRANSACTION', ...account, externalKey: key, transactedAt: at, amount, balanceAfter, summary }
}

const RECORDS: ScrapedRecord[] = [
  { type: 'BANK_ACCOUNT', ...MAIN, accountTypeCode: '01', alias: '운영자금', balance: 71_450_000 },
  { type: 'BANK_ACCOUNT', ...SUB, accountTypeCode: '01', alias: '급여통장', balance: 2_000_000 },
  {
    type: 'BANK_ACCOUNT',
    bankCode: '003',
    accountNumber: '555-66-777888',
    accountTypeCode: '41',
    alias: '시설자금 대출',
    balance: 100_000_000,
  },
  { type: 'BANK_BALANCE', ...MAIN, date: '2026-09-30', closingBalance: 40_000_000 },
  { type: 'BANK_BALANCE', ...SUB, date: '2026-09-30', closingBalance: 10_000_000 },
  tx(MAIN, 'main-1006', '2026-10-06T10:00:00+09:00', 33_000_000, 73_000_000, '에코프로비엠'),
  tx(MAIN, 'main-1010', '2026-10-10T10:00:00+09:00', -11_000_000, 62_000_000, '오피스디포'),
  tx(MAIN, 'main-1015', '2026-10-15T10:00:00+09:00', -2_200_000, 59_800_000, '강남빌딩 임대료'),
  tx(MAIN, 'main-1021', '2026-10-21T10:00:00+09:00', 30_000, 59_830_000, '이자'),
  tx(MAIN, 'main-1028', '2026-10-28T10:00:00+09:00', 9_900_000, 69_730_000, 'KB카드 정산'),
  tx(MAIN, 'main-1031a', '2026-10-31T10:00:00+09:00', 2_000_000, 71_730_000, '에코프로비엠 선급'),
  tx(MAIN, 'main-1031b', '2026-10-31T15:00:00+09:00', -300_000, 71_430_000, '통신비 자동이체'),
  tx(SUB, 'sub-1025', '2026-10-25T10:00:00+09:00', -8_000_000, 2_000_000, '10월 급여'),
  { type: 'BANK_BALANCE', ...MAIN, date: '2026-10-31', closingBalance: 71_450_000 },
  {
    type: 'SALES_EVIDENCE',
    source: 'TAX_INVOICE',
    externalKey: '20261005-41000000-00000001',
    writtenOn: '2026-10-05',
    docType: 'TAX_INVOICE',
    kind: 'NORMAL',
    counterpartyName: '에코프로비엠',
    counterpartyBusinessNumber: '110-81-00011',
    itemSummary: '2차전지 소재 외 2건',
    totalAmount: 33_000_000,
    supplyAmount: 30_000_000,
    vatAmount: 3_000_000,
  },
  { type: 'SALES_EVIDENCE', source: 'CARD', externalKey: 's-2', writtenOn: '2026-10-12', totalAmount: 11_000_000 },
  {
    type: 'SALES_EVIDENCE',
    source: 'CARD',
    externalKey: 's-3',
    writtenOn: '2026-10-13',
    totalAmount: -1_100_000,
    isCanceled: true,
  },
  {
    type: 'SALES_EVIDENCE',
    source: 'PG',
    externalKey: 's-4',
    writtenOn: '2026-10-20',
    totalAmount: 5_500_000,
    vatAmount: 500_000,
    channel: '토스페이먼츠',
    dedupeGroup: 'order-77',
  },
  {
    type: 'SALES_EVIDENCE',
    source: 'DELIVERY',
    externalKey: 's-5',
    writtenOn: '2026-10-20',
    totalAmount: 5_500_000,
    vatAmount: 500_000,
    channel: '배달의민족',
    dedupeGroup: 'order-77',
  },
  {
    type: 'SALES_EVIDENCE',
    source: 'MALL',
    externalKey: 's-6',
    writtenOn: '2026-10-22',
    totalAmount: 2_200_000,
    vatAmount: 200_000,
    channel: '스마트스토어',
  },
  {
    type: 'PURCHASE_EVIDENCE',
    source: 'TAX_INVOICE',
    externalKey: '20261007-41000000-00000002',
    writtenOn: '2026-10-07',
    docType: 'TAX_INVOICE',
    kind: 'NORMAL',
    counterpartyName: '오피스디포',
    counterpartyBusinessNumber: '2208100022',
    itemSummary: '사무용 집기',
    supplyAmount: 10_000_000,
    vatAmount: 1_000_000,
    vatDeduction: 'DEDUCTIBLE',
  },
  {
    type: 'PURCHASE_EVIDENCE',
    source: 'CARD',
    externalKey: 'p-2',
    writtenOn: '2026-10-09',
    counterpartyName: '한식당',
    supplyAmount: 500_000,
    vatAmount: 50_000,
    vatDeduction: 'NON_DEDUCTIBLE',
  },
  {
    type: 'PURCHASE_EVIDENCE',
    source: 'CARD',
    externalKey: 'p-3',
    writtenOn: '2026-10-15',
    counterpartyName: '편의점',
    supplyAmount: 300_000,
    vatAmount: 30_000,
  },
]

function giro(
  n: number,
  number: string,
  taxKind: 'NATIONAL' | 'LOCAL',
  taxName: string,
  payAmount: number,
  dueDate: string,
  status: GiroRecord['status'],
): GiroRecord {
  return {
    id: `gir_01JBQ00000000000000000000${n}` as Id<'giro'>,
    companyId: DEMO_COMPANY_ID,
    electronicPaymentNumber: number,
    taxKind,
    slipType: taxKind === 'NATIONAL' ? '국세' : '지방세',
    taxName,
    billingOrganization: taxKind === 'NATIONAL' ? '역삼세무서' : '강남구청',
    payAmount,
    dueDate,
    detail: {},
    status,
    doneReason: status === 'DONE' ? 'MARKED_BY_USER' : null,
    memo: '',
    statusChangedAt: SEEDED_AT,
    history: [{ type: 'CREATED', memo: '', actorUserId: null, at: SEEDED_AT }],
    version: 1,
  }
}

const GIROS: GiroRecord[] = [
  giro(1, '0126110300000000001', 'NATIONAL', '부가가치세', 1_200_000, '2026-11-03', 'TODO'),
  giro(2, '2611260000000000002', 'LOCAL', '주민세(사업소분)', 62_500, '2026-11-30', 'TODO'),
  giro(3, '0126093000000000003', 'NATIONAL', '원천세', 340_000, '2026-09-30', 'UNKNOWN'),
  giro(4, '0126081000000000004', 'NATIONAL', '원천세', 310_000, '2026-08-10', 'DONE'),
]

/**
 * 현행 데모 시드(`legacy/src/db/seeds/`)의 숫자를 옮긴 데모 데이터를 넣습니다. 수집은 실제 수신 서비스를 거칩니다.
 *
 * 2026년 10월 실시간 손익(공급가액 기준): 매출 44,000,000, 매출원가 10,000,000, 판관비 11,000,000,
 * 영업외수익 30,000, 순이익 23,030,000. 10월 31일 자금: 시작 71,730,000, 입금 2,000,000, 출금 −300,000,
 * 기타 20,000, 마감 73,450,000.
 */
export const seedDemo = Effect.gen(function* () {
  const partners = yield* PartnerRepository
  const rules = yield* ClassificationRuleRepository
  const evidence = yield* EvidenceRepository
  const transactions = yield* BankTransactionRepository
  const links = yield* SettlementLinkRepository
  const giros = yield* GiroRepository
  const ingestion = yield* ScrapedRecordIngestion

  yield* partners.saveAll([
    partner(DEMO_PARTNERS.ecopro, '에코프로비엠', '1108100011', 'SALES'),
    partner(DEMO_PARTNERS.office, '오피스디포', '2208100022', 'PURCHASE'),
    partner(DEMO_PARTNERS.landlord, '강남빌딩', '3308100033', 'PURCHASE'),
  ])
  yield* rules.saveAll(RULES)
  yield* ingestion.ingest(DEMO_COMPANY_ID, RECORDS)
  yield* giros.saveAll(GIROS)

  const manual = (accountCode: string) => ({
    accountTitleId: systemAccountTitleIdOf(accountCode),
    method: 'MANUAL' as const,
    ruleId: null,
  })
  const byKey = new Map((yield* evidence.list(DEMO_COMPANY_ID)).map((row) => [row.externalKey, row]))
  const classify = (key: string, accountCode: string): EvidenceRecord[] => {
    const row = byKey.get(key)
    return row === undefined ? [] : [{ ...row, classification: manual(accountCode) }]
  }
  yield* evidence.saveAll([
    ...classify('20261005-41000000-00000001', 'sales.revenue'),
    ...classify('s-4', 'sales.revenue'),
    ...classify('20261007-41000000-00000002', 'cogs.goods'),
  ])

  const txByKey = new Map((yield* transactions.list(DEMO_COMPANY_ID)).map((row) => [row.externalKey, row]))
  const purchaseOut = txByKey.get('main-1010')
  const interest = txByKey.get('main-1021')
  yield* transactions.saveAll([
    ...(purchaseOut === undefined
      ? []
      : [{ ...purchaseOut, partnerId: DEMO_PARTNERS.office, classification: manual('trade.purchase_out') }]),
    ...(interest === undefined ? [] : [{ ...interest, classification: manual('non_op_income.interest') }]),
  ])

  const salesIn = txByKey.get('main-1006')
  const invoice = byKey.get('20261005-41000000-00000001')
  if (salesIn !== undefined && invoice !== undefined) {
    yield* links.save({
      id: 'stl_01JBQ000000000000000000001' as Id<'settlementLink'>,
      companyId: DEMO_COMPANY_ID,
      bankTransactionId: salesIn.id,
      evidenceId: invoice.id,
      amount: 33_000_000,
      createdAt: SEEDED_AT,
    })
  }
})
