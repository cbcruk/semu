import type { IncomeTaxReductionReason } from './tax-withholding.types.ts'

/**
 * 소득세 감면 사유와 법정 감면율·기간·연 한도입니다(현행 R20).
 *
 * - 중소기업 취업자 감면(조특법 제30조): 청년 90%·5년, 고령자·장애인·경력단절여성 70%·3년, 연 200만원
 * - 내국인 우수인력 국내복귀 감면(제18조의3): 50%·10년
 * - 외국인 기술자 감면(제18조): 50%·10년, 특화선도기업은 70%·3년
 *
 * 감면율은 ppm입니다. 이름은 제품 표시 문자열입니다.
 */
export const INCOME_TAX_REDUCTION_REASONS: ReadonlyArray<IncomeTaxReductionReason> = [
  { type: 'SMALL_BUSINESS', code: 'YOUTH', name: '청년', ratePpm: 900_000, periodYears: 5, annualLimit: 2_000_000 },
  {
    type: 'SMALL_BUSINESS',
    code: 'ELDERLY',
    name: '60세 이상 고령자',
    ratePpm: 700_000,
    periodYears: 3,
    annualLimit: 2_000_000,
  },
  {
    type: 'SMALL_BUSINESS',
    code: 'DISABLED',
    name: '장애인',
    ratePpm: 700_000,
    periodYears: 3,
    annualLimit: 2_000_000,
  },
  {
    type: 'SMALL_BUSINESS',
    code: 'CAREER_BREAK_WOMAN',
    name: '경력단절여성',
    ratePpm: 700_000,
    periodYears: 3,
    annualLimit: 2_000_000,
  },
  {
    type: 'RETURNING_KOREAN_TALENT',
    code: 'RETURNING_TALENT',
    name: '내국인 우수인력 국내복귀',
    ratePpm: 500_000,
    periodYears: 10,
  },
  { type: 'FOREIGN_TECHNICIAN', code: 'FOREIGN_TECHNICIAN', name: '외국인 기술자', ratePpm: 500_000, periodYears: 10 },
  {
    type: 'FOREIGN_TECHNICIAN',
    code: 'FOREIGN_TECHNICIAN_SPECIALIZED',
    name: '외국인 기술자(특화선도기업)',
    ratePpm: 700_000,
    periodYears: 3,
  },
]
