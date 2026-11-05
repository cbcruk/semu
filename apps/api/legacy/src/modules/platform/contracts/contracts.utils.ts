import type { ContractForm, ContractRow, FeeInputs, FeeQuote } from './contracts.types'

/** Revenue bands of sole proprietors, smallest first. */
export const SOLE_REVENUE_BANDS = [
  'sole_under_50m',
  'sole_50m_to_100m',
  'sole_100m_to_300m',
  'sole_300m_to_500m',
  'sole_500m_to_1b',
  'sole_1b_to_3b',
  'sole_3b_to_5b',
  'sole_5b_to_10b',
  'sole_10b_to_20b',
  'sole_over_20b',
] as const

/** Revenue bands of corporations, smallest first. */
export const CORP_REVENUE_BANDS = [
  'corp_under_300m',
  'corp_300m_to_500m',
  'corp_500m_to_1b',
  'corp_1b_to_2b',
  'corp_2b_to_3b',
  'corp_3b_to_5b',
  'corp_5b_to_10b',
  'corp_10b_to_15b',
  'corp_15b_to_20b',
  'corp_over_20b',
] as const

const SOLE_BASE = [100_000, 120_000, 150_000, 180_000, 220_000, 280_000, 350_000, 450_000, 600_000, 800_000]
const CORP_BASE = [150_000, 180_000, 220_000, 260_000, 300_000, 350_000, 450_000, 600_000, 750_000, 1_000_000]
const EMPLOYEE_SURCHARGE: Record<FeeInputs['employee_number'], number> = {
  under_10: 0,
  from_10_to_20: 50_000,
  from_21_to_30: 100_000,
  from_31_to_50: 150_000,
  above_50: 250_000,
}
const INDUSTRY_BASIS_POINTS: Record<FeeInputs['business_type'], number> = {
  etc: 10_000,
  construction: 12_000,
  manufacturing: 11_000,
  trade: 11_000,
  lending: 12_000,
  other_professional_service: 10_000,
}
const PERIOD_SURCHARGE: Record<FeeInputs['accounting_period'], number> = { annual: 0, semi_annual: 30_000, quarterly: 60_000, monthly: 100_000 }
const DILIGENT_SURCHARGE = 500_000

/**
 * Quotes the monthly bookkeeping fee and the yearly adjustment fee (VAT excluded).
 *
 * The real price table is not in the client; this table is a placeholder with
 * the same inputs. Fees are rounded down to 10,000 won.
 *
 * @returns The quote, or `null` when the revenue band is unknown.
 *
 * @example A small corporation
 * ```ts
 * import { quoteFee } from './contracts.utils'
 *
 * quoteFee({ revenue: 'corp_under_300m', employee_number: 'under_10', business_type: 'etc', accounting_period: 'annual', diligent_business: 'no' })
 * // { monthlyFee: 150_000, adjustmentFee: 300_000, ... }
 * ```
 */
export function quoteFee(inputs: FeeInputs): FeeQuote | null {
  const soleIndex = (SOLE_REVENUE_BANDS as readonly string[]).indexOf(inputs.revenue)
  const corpIndex = (CORP_REVENUE_BANDS as readonly string[]).indexOf(inputs.revenue)
  const base = soleIndex >= 0 ? SOLE_BASE[soleIndex] : corpIndex >= 0 ? CORP_BASE[corpIndex] : undefined
  if (base === undefined) return null
  const employees = EMPLOYEE_SURCHARGE[inputs.employee_number]
  const industryBasisPoints = INDUSTRY_BASIS_POINTS[inputs.business_type]
  const accountingPeriod = PERIOD_SURCHARGE[inputs.accounting_period]
  const raw = Math.floor(((base + employees) * industryBasisPoints) / 10_000) + accountingPeriod
  const monthlyFee = Math.floor(raw / 10_000) * 10_000
  const diligent = inputs.diligent_business === 'yes' ? DILIGENT_SURCHARGE : 0
  return { monthlyFee, adjustmentFee: monthlyFee * 2 + diligent, breakdown: { base, employees, industryBasisPoints, accountingPeriod, diligent } }
}

/**
 * Renders the online bookkeeping contract (온라인 수임 계약서) as structured articles.
 *
 * Article texts are product copy shown to Korean customers.
 */
export function renderContract(contract: ContractRow): Record<string, unknown> {
  const form = contract.form === null ? null : (JSON.parse(contract.form) as ContractForm)
  const fee = contract.monthly_fee.toLocaleString('ko-KR')
  return {
    contract_id: contract.id,
    name: '수임계약서',
    kind: contract.kind,
    status: contract.status,
    company_name: form?.company_name ?? null,
    representative_name: form?.representative_name ?? null,
    business_number: contract.business_number,
    monthly_fee: contract.monthly_fee,
    adjustment_fee: contract.adjustment_fee,
    effective_on: contract.effective_on,
    signed_at: contract.signed_at,
    articles: [
      { number: 1, title: '목적', body: '위임인은 수임인에게 기장 및 세무 신고 대리 업무를 위임하고 수임인은 이를 수임한다.' },
      { number: 2, title: '업무 범위', body: '장부 기장, 부가가치세·원천세·법인세(종합소득세) 신고 대리 및 이에 부수하는 업무.' },
      { number: 3, title: '자료 제공', body: '위임인은 업무 수행에 필요한 자료를 기한 내에 제공한다.' },
      { number: 4, title: '계약 기간', body: '계약 기간은 1년으로 하며, 만료 1개월 전까지 별도 의사 표시가 없으면 같은 조건으로 1년씩 자동 연장한다.' },
      { number: 5, title: '보수', body: `월 기장보수는 ${fee}원(VAT 별도)으로 한다. 조정수수료는 법인 3월, 개인 5월에 청구한다.` },
    ],
  }
}

/** Checks whether a contract has passed its signing deadline. */
export function isContractExpired(contract: ContractRow, now: string): boolean {
  return contract.status !== 'signed' && contract.status !== 'active' && Date.parse(contract.expires_at) <= Date.parse(now)
}
