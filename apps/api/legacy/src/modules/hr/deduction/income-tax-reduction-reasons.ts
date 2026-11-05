import type { IncomeTaxReductionReason } from './deduction.types'

/**
 * Income tax reduction reasons with their statutory rate, period and yearly cap (rule R20).
 *
 * - 중소기업 취업자 감면 (조세특례제한법 제30조): youth 90% for 5 years; older, disabled and career-break employees 70% for 3 years; 2,000,000 won a year.
 * - 내국인 우수인력 국내복귀 감면 (제18조의3): 50% for 10 years, as the spec notes it.
 * - 외국인 기술자 감면 (제18조): 50% for 10 years, or 70% for the first 3 years at 특화선도기업.
 *
 * Names are product labels.
 */
export const INCOME_TAX_REDUCTION_REASONS: readonly IncomeTaxReductionReason[] = [
  { type: 'small_biz', code: 'youth', name: '청년', rate: 90, period_years: 5, annual_limit: 2_000_000 },
  { type: 'small_biz', code: 'elderly', name: '60세 이상 고령자', rate: 70, period_years: 3, annual_limit: 2_000_000 },
  { type: 'small_biz', code: 'disabled', name: '장애인', rate: 70, period_years: 3, annual_limit: 2_000_000 },
  { type: 'small_biz', code: 'career_break_woman', name: '경력단절여성', rate: 70, period_years: 3, annual_limit: 2_000_000 },
  { type: 'returning_korean_talent', code: 'returning_talent', name: '내국인 우수인력 국내복귀', rate: 50, period_years: 10, annual_limit: null },
  { type: 'foreign_technician', code: 'foreign_technician', name: '외국인 기술자', rate: 50, period_years: 10, annual_limit: null },
  { type: 'foreign_technician', code: 'foreign_technician_specialized', name: '외국인 기술자(특화선도기업)', rate: 70, period_years: 3, annual_limit: null },
]
