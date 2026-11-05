import type { PaymentCatalogGroup, PaymentCatalogItem } from './settings.types'

interface CatalogFlags {
  monthly: boolean
  ordinary: boolean
  average: boolean
  minimum: boolean
}

const FIXED_PAY: CatalogFlags = { monthly: true, ordinary: true, average: true, minimum: true }
const VARIABLE_PAY: CatalogFlags = { monthly: false, ordinary: false, average: true, minimum: false }
const NON_TAXABLE: CatalogFlags = { monthly: true, ordinary: false, average: true, minimum: false }
const FIXED_OVERTIME: CatalogFlags = { monthly: true, ordinary: false, average: true, minimum: false }

function item(
  code: string,
  name: string,
  group: PaymentCatalogGroup,
  flags: CatalogFlags,
  description: string,
  extra: Partial<Pick<PaymentCatalogItem, 'nonTaxableCategory' | 'standardNameRequired'>> = {},
): PaymentCatalogItem {
  const nonTaxableCategory = extra.nonTaxableCategory ?? null
  return {
    code,
    name,
    group,
    isTaxable: nonTaxableCategory === null,
    nonTaxableCategory,
    description,
    standardNameRequired: extra.standardNameRequired ?? nonTaxableCategory !== null,
    includeInMonthlySalary: flags.monthly,
    includeInOrdinaryWage: flags.ordinary,
    includeInAverageWage: flags.average,
    includeInMinimumWage: flags.minimum,
  }
}

/**
 * Standard payment items of the "항목 불러오기" catalog.
 *
 * Names follow the manual and screens 5caba01c, 6938e484, b1396623. Non-taxable
 * items and 연차수당 must keep the standard name. The default inclusion flags
 * are a proposal (추정) based on how each item usually behaves.
 */
export const PAYMENT_CATALOG: readonly PaymentCatalogItem[] = [
  item('base_pay', '기본급', 'base', FIXED_PAY, '소정근로에 대한 기본 임금'),
  item('overtime_pay', '연장근로수당', 'overtime', VARIABLE_PAY, '연장근로 시간 × 통상시급 × 연장 배수'),
  item('night_pay', '야간근로수당', 'overtime', VARIABLE_PAY, '야간근로(22시~06시) 시간 × 통상시급 × 야간 배수'),
  item('holiday_pay', '휴일근로수당', 'overtime', VARIABLE_PAY, '휴일근로(8시간 이내) 시간 × 통상시급 × 휴일 배수'),
  item('holiday_overtime_pay', '휴일연장근로수당', 'overtime', VARIABLE_PAY, '휴일근로 8시간 초과분 × 통상시급 × 휴일연장 배수'),
  item('fixed_overtime_pay', '고정연장근로수당', 'fixed_overtime', FIXED_OVERTIME, '근로시간 정책의 고정 연장근로 시간에 따른 수당'),
  item('fixed_night_pay', '고정야간근로수당', 'fixed_overtime', FIXED_OVERTIME, '근로시간 정책의 고정 야간근로 시간에 따른 수당'),
  item('fixed_holiday_pay', '고정휴일근로수당', 'fixed_overtime', FIXED_OVERTIME, '근로시간 정책의 고정 휴일근로 시간에 따른 수당'),
  item('fixed_holiday_overtime_pay', '고정휴일연장근로수당', 'fixed_overtime', FIXED_OVERTIME, '근로시간 정책의 고정 휴일연장근로 시간에 따른 수당'),
  item('annual_leave_pay', '연차수당', 'leave', VARIABLE_PAY, '미사용 연차휴가에 대한 수당', { standardNameRequired: true }),
  item('bonus', '상여금', 'bonus', VARIABLE_PAY, '정기·비정기 상여'),
  item('performance_bonus', '성과급', 'bonus', VARIABLE_PAY, '성과에 따른 상여'),
  item('qualification_allowance', '자격수당', 'allowance', FIXED_PAY, '자격 보유에 대한 고정 수당'),
  item('position_allowance', '직책수당', 'allowance', FIXED_PAY, '직책에 대한 고정 수당'),
  item('meal', '식대', 'non_taxable', NON_TAXABLE, '월 20만원까지 비과세', { nonTaxableCategory: 'meal' }),
  item('vehicle', '차량유지비', 'non_taxable', NON_TAXABLE, '자가운전보조금, 월 20만원까지 비과세', { nonTaxableCategory: 'vehicle' }),
  item('childcare', '육아수당', 'non_taxable', NON_TAXABLE, '출산·6세 이하 보육수당, 월 20만원까지 비과세', { nonTaxableCategory: 'childcare' }),
  item('research', '연구수당', 'non_taxable', NON_TAXABLE, '연구보조비, 월 20만원까지 비과세', { nonTaxableCategory: 'research' }),
  item('overseas', '국외근로수당', 'non_taxable', NON_TAXABLE, '국외근로 급여, 월 100만원까지 비과세', { nonTaxableCategory: 'overseas' }),
  item('night_shift', '생산직 야간근로수당', 'non_taxable', VARIABLE_PAY, '생산직 등 야간근로수당, 연 240만원까지 비과세', { nonTaxableCategory: 'night_shift' }),
  item('parental_leave', '육아휴직수당', 'non_taxable', VARIABLE_PAY, '육아휴직 급여', { nonTaxableCategory: 'parental_leave' }),
  item('tuition', '학자금지원', 'non_taxable', VARIABLE_PAY, '요건을 갖춘 학자금', { nonTaxableCategory: 'tuition' }),
  item('invention', '직무발명보상금', 'non_taxable', VARIABLE_PAY, '연 700만원까지 비과세', { nonTaxableCategory: 'invention' }),
]

/** Catalog codes created as payment items for every company on first use; `base_pay` cannot be deleted. */
export const DEFAULT_PAYMENT_ITEM_CODES: readonly string[] = [
  'base_pay',
  'overtime_pay',
  'night_pay',
  'holiday_pay',
  'holiday_overtime_pay',
  'annual_leave_pay',
  'meal',
]

/** Finds a catalog item by code. */
export function findCatalogItem(code: string): PaymentCatalogItem | undefined {
  return PAYMENT_CATALOG.find((entry) => entry.code === code)
}
