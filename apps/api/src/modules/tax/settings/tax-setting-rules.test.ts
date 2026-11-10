import { describe, expect, it } from 'vitest'
import { defaultTaxSetting } from './tax-setting.ts'
import { validateTaxSetting } from './tax-setting-rules.ts'
import type { TaxSettingRecord } from './tax-setting.types.ts'

function setting(overrides: Partial<TaxSettingRecord> = {}): TaxSettingRecord {
  return { ...defaultTaxSetting(), ...overrides }
}

describe('세무 설정 검증(validateTaxSetting)', () => {
  it('기본 설정은 법인과 개인 모두 통과합니다', () => {
    expect(validateTaxSetting(setting(), 'CORPORATION')).toBeUndefined()
    expect(validateTaxSetting(setting(), 'INDIVIDUAL')).toBeUndefined()
  })

  it.each([0, 13, 3.5])('결산월 %s는 1–12 밖이라 거절합니다', (month) => {
    expect(validateTaxSetting(setting({ fiscalYearEndMonth: month }), 'CORPORATION')).toEqual({
      reason: 'FISCAL_YEAR_END_MONTH_OUT_OF_RANGE',
      field: 'fiscalYearEndMonth',
    })
  })

  it('원천세 반기 납부면 적용 시작 반기가 있어야 합니다', () => {
    expect(validateTaxSetting(setting({ withholdingCycle: 'SEMIANNUAL' }), 'CORPORATION')).toEqual({
      reason: 'SEMIANNUAL_START_REQUIRED',
      field: 'withholdingSemiannualFrom',
    })
  })

  it('원천세 매월 납부면 적용 시작 반기를 둘 수 없습니다', () => {
    expect(validateTaxSetting(setting({ withholdingSemiannualFrom: '2027-H1' }), 'CORPORATION')).toEqual({
      reason: 'SEMIANNUAL_START_NOT_ALLOWED',
      field: 'withholdingSemiannualFrom',
    })
  })

  it('반기 납부 적용 시작은 반기 키여야 합니다', () => {
    expect(
      validateTaxSetting(
        setting({ withholdingCycle: 'SEMIANNUAL', withholdingSemiannualFrom: '2027-01' }),
        'CORPORATION',
      ),
    ).toEqual({ reason: 'PERIOD_KEY_INVALID', field: 'withholdingSemiannualFrom' })
    expect(
      validateTaxSetting(
        setting({ withholdingCycle: 'SEMIANNUAL', withholdingSemiannualFrom: '2027-H2' }),
        'CORPORATION',
      ),
    ).toBeUndefined()
  })

  it('법인은 3월 결산을 둘 수 있습니다', () => {
    expect(validateTaxSetting(setting({ fiscalYearEndMonth: 3 }), 'CORPORATION')).toBeUndefined()
  })

  it('개인사업자는 소득세 과세기간이 역년이라 12월 결산이 아니면 거절합니다', () => {
    expect(validateTaxSetting(setting({ fiscalYearEndMonth: 6 }), 'INDIVIDUAL')).toEqual({
      reason: 'INDIVIDUAL_FISCAL_YEAR_NOT_CALENDAR',
      field: 'fiscalYearEndMonth',
    })
  })

  it('법인은 간이과세자가 될 수 없습니다', () => {
    expect(validateTaxSetting(setting({ vatTaxpayerType: 'SIMPLIFIED' }), 'CORPORATION')).toEqual({
      reason: 'CORPORATION_CANNOT_BE_SIMPLIFIED',
      field: 'vatTaxpayerType',
    })
  })

  it('개인 간이과세자는 세금계산서 발급 여부를 참으로 둘 수 있습니다', () => {
    expect(
      validateTaxSetting(setting({ vatTaxpayerType: 'SIMPLIFIED', vatSimplifiedInvoiceIssuer: true }), 'INDIVIDUAL'),
    ).toBeUndefined()
  })

  it('일반과세자는 세금계산서 발급 여부를 참으로 둘 수 없습니다', () => {
    expect(validateTaxSetting(setting({ vatSimplifiedInvoiceIssuer: true }), 'INDIVIDUAL')).toEqual({
      reason: 'INVOICE_ISSUER_REQUIRES_SIMPLIFIED',
      field: 'vatSimplifiedInvoiceIssuer',
    })
  })

  it.each([-1, 1_000_001])('카드 과세 비율 %sppm은 0–1,000,000 밖이라 거절합니다', (ppm) => {
    expect(validateTaxSetting(setting({ taxableCardRatioPpm: ppm }), 'CORPORATION')).toEqual({
      reason: 'TAXABLE_CARD_RATIO_OUT_OF_RANGE',
      field: 'taxableCardRatioPpm',
    })
  })

  it('카드 과세 비율은 0%와 100%를 받습니다', () => {
    expect(validateTaxSetting(setting({ taxableCardRatioPpm: 0 }), 'CORPORATION')).toBeUndefined()
    expect(validateTaxSetting(setting({ taxableCardRatioPpm: 1_000_000 }), 'CORPORATION')).toBeUndefined()
  })

  it.each(['2026-H3', '2026-Q1', '26-H1', '2026-h1'])('공급가액의 과세기간 키 %s는 거절합니다', (key) => {
    expect(validateTaxSetting(setting({ vatSupplyAmounts: { [key]: 1 } }), 'CORPORATION')).toEqual({
      reason: 'PERIOD_KEY_INVALID',
      field: `vatSupplyAmounts.${key}`,
    })
  })

  it('예정신고 선택의 과세기간 키도 같은 형식이어야 합니다', () => {
    expect(
      validateTaxSetting(setting({ vatPreliminaryElections: { '2027-04': 'EARLY_REFUND' } }), 'CORPORATION'),
    ).toEqual({ reason: 'PERIOD_KEY_INVALID', field: 'vatPreliminaryElections.2027-04' })
  })

  it.each([-1, 0.5])('공급가액 %s원은 0 이상의 정수가 아니라 거절합니다', (amount) => {
    expect(validateTaxSetting(setting({ vatSupplyAmounts: { '2026-H2': amount } }), 'CORPORATION')).toEqual({
      reason: 'VAT_SUPPLY_AMOUNT_INVALID',
      field: 'vatSupplyAmounts.2026-H2',
    })
  })

  it('올바른 과세기간별 값은 통과합니다', () => {
    expect(
      validateTaxSetting(
        setting({
          vatSupplyAmounts: { '2026-H1': 0, '2026-H2': 120_000_000 },
          vatPreliminaryElections: { '2027-H1': 'BUSINESS_DECLINE' },
        }),
        'CORPORATION',
      ),
    ).toBeUndefined()
  })
})
