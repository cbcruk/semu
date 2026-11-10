import type { BusinessType } from '../../identity-access/actor.types.ts'
import type { TaxSettingRecord, TaxSettingViolation } from './tax-setting.types.ts'

/** 카드 과세 비율의 상한입니다. 100%가 1,000,000ppm입니다. */
const 과세비율상한ppm = 1_000_000

/** 부가세 과세기간 키입니다. 일반과세자의 과세기간은 1기(1–6월)·2기(7–12월)입니다(부가가치세법 제5조 ①). */
const 과세기간키 = /^\d{4}-H[12]$/

/**
 * 회사 세무 설정이 사업자 형태와 법령에 맞는지 봅니다. 맞으면 `undefined`, 아니면 처음 걸린 위반 하나입니다.
 *
 * - 사업연도 종료 월은 1–12입니다
 * - 개인사업자는 12월 결산입니다. 소득세 과세기간이 1월 1일–12월 31일이기 때문입니다(소득세법 제5조 ①)
 * - 법인은 간이과세자가 될 수 없습니다. 간이과세는 개인사업자만 받습니다(부가가치세법 제61조 ①)
 * - 세금계산서 발급 여부(`vatSimplifiedInvoiceIssuer`)는 간이과세자의 예정부과 대신 예정신고를 정하는 값이라(제66조 ③)
 *   간이과세자가 아니면 참일 수 없습니다
 * - 카드 과세 비율은 0–1,000,000ppm입니다
 * - 과세기간별 공급가액과 예정신고 선택의 키는 `YYYY-H1`·`YYYY-H2`이고, 공급가액은 0 이상의 정수(원)입니다
 *
 * @example
 * ```ts
 * validateTaxSetting({ ...defaults, fiscalYearEndMonth: 3 }, 'INDIVIDUAL')
 * // { reason: 'INDIVIDUAL_FISCAL_YEAR_NOT_CALENDAR', field: 'fiscalYearEndMonth' }
 * ```
 */
export function validateTaxSetting(
  setting: Omit<TaxSettingRecord, 'version' | 'updatedAt'>,
  businessType: BusinessType,
): TaxSettingViolation | undefined {
  const 결산월 = setting.fiscalYearEndMonth
  if (!Number.isInteger(결산월) || 결산월 < 1 || 결산월 > 12) {
    return { reason: 'FISCAL_YEAR_END_MONTH_OUT_OF_RANGE', field: 'fiscalYearEndMonth' }
  }
  if (businessType === 'INDIVIDUAL' && 결산월 !== 12) {
    return { reason: 'INDIVIDUAL_FISCAL_YEAR_NOT_CALENDAR', field: 'fiscalYearEndMonth' }
  }
  const 간이과세자임 = setting.vatTaxpayerType === 'SIMPLIFIED'
  if (businessType === 'CORPORATION' && 간이과세자임) {
    return { reason: 'CORPORATION_CANNOT_BE_SIMPLIFIED', field: 'vatTaxpayerType' }
  }
  if (setting.vatSimplifiedInvoiceIssuer && !간이과세자임) {
    return { reason: 'INVOICE_ISSUER_REQUIRES_SIMPLIFIED', field: 'vatSimplifiedInvoiceIssuer' }
  }
  const 과세비율 = setting.taxableCardRatioPpm
  if (!Number.isInteger(과세비율) || 과세비율 < 0 || 과세비율 > 과세비율상한ppm) {
    return { reason: 'TAXABLE_CARD_RATIO_OUT_OF_RANGE', field: 'taxableCardRatioPpm' }
  }
  for (const [기간, 공급가액] of Object.entries(setting.vatSupplyAmounts)) {
    if (!과세기간키.test(기간)) return { reason: 'VAT_PERIOD_KEY_INVALID', field: `vatSupplyAmounts.${기간}` }
    if (!Number.isInteger(공급가액) || 공급가액 < 0) {
      return { reason: 'VAT_SUPPLY_AMOUNT_INVALID', field: `vatSupplyAmounts.${기간}` }
    }
  }
  for (const 기간 of Object.keys(setting.vatPreliminaryElections)) {
    if (!과세기간키.test(기간)) return { reason: 'VAT_PERIOD_KEY_INVALID', field: `vatPreliminaryElections.${기간}` }
  }
  return undefined
}
