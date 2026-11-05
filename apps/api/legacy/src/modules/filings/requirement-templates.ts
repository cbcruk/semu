import type { FilingKind, TaxType } from '../tax-calendar/tax-calendar.types'
import type { RequirementTemplate } from './filings.types'

const SURTAX_TEMPLATE: readonly RequirementTemplate[] = [
  { code: 'pg_online_sales', label: 'PG사·온라인 매출 내역', autoLinked: false },
  { code: 'export_fx', label: '국외 수출 자료(외화 계좌 거래 내역)', autoLinked: false },
  { code: 'paper_tax_invoice', label: '당월분 종이 세금계산서·종이 계산서', autoLinked: false },
  { code: 'simple_receipt', label: '당월분 간이영수증', autoLinked: false },
  { code: 'ending_inventory', label: '당월 말 재고금액', autoLinked: false },
  { code: 'deposit_fund_accounts', label: '예·적금 계좌, 펀드 계좌', autoLinked: false },
]

const PAYROLL_LEDGER: RequirementTemplate = { code: 'payroll_ledger_closed', label: '급여대장 마감분', autoLinked: true }

const WITHHOLDING_TEMPLATE: readonly RequirementTemplate[] = [
  { code: 'business_income', label: '사업소득(프리랜서·용역비) 지급 내역', autoLinked: false },
  { code: 'other_income', label: '기타소득 지급 내역', autoLinked: false },
  { code: 'daily_wage', label: '일용직 근로소득 지급 내역', autoLinked: false },
  { code: 'retirement_income', label: '퇴직소득 지급 내역', autoLinked: false },
  { code: 'interest_dividend', label: '이자·배당소득 등 지급 내역', autoLinked: false },
  { code: 'unreflected_bonus', label: '급여에 반영되지 않은 상여·수당 지급 내역', autoLinked: false },
]

/**
 * Returns the requirement checklist copied into a new filing.
 *
 * Labels come from the Alfred manual. Notices have no checklist, and the
 * payroll ledger item is added only for companies on the payroll plan.
 */
export function requirementsFor(taxType: TaxType, kind: FilingKind, hasPayrollPlan: boolean): RequirementTemplate[] {
  if (kind === 'notice') return []
  if (taxType === 'surtax') return [...SURTAX_TEMPLATE]
  if (taxType === 'withholding_tax') return hasPayrollPlan ? [PAYROLL_LEDGER, ...WITHHOLDING_TEMPLATE] : [...WITHHOLDING_TEMPLATE]
  return []
}
