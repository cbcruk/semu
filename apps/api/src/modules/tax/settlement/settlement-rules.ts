import { addMonths, lastDayOfMonth } from '../../../shared/time/calendar.ts'
import type {
  FiscalPeriod,
  ProfitLossInputMonth,
  ProfitLossInputSection,
  ProfitLossMonth,
  ProfitLossSection,
  ProfitLossSectionAmount,
  ProfitLossUpload,
  SettlementSnapshotViolation,
  SettlementAccountAmount,
} from './settlement-report.types.ts'

/** 담당자가 올리는 섹션입니다. 손익계산서 순서입니다. */
export const PROFIT_LOSS_INPUT_SECTIONS: ReadonlyArray<ProfitLossInputSection> = [
  'REVENUE',
  'COST_OF_SALES',
  'SELLING_AND_ADMINISTRATIVE_EXPENSES',
  'NON_OPERATING_INCOME',
  'NON_OPERATING_EXPENSES',
  'INCOME_TAXES',
]

/** 응답의 섹션 순서입니다. 손익계산서 표의 행 순서와 같습니다. */
export const PROFIT_LOSS_SECTIONS: ReadonlyArray<ProfitLossSection> = [
  'REVENUE',
  'COST_OF_SALES',
  'GROSS_PROFIT',
  'SELLING_AND_ADMINISTRATIVE_EXPENSES',
  'OPERATING_INCOME',
  'NON_OPERATING_INCOME',
  'NON_OPERATING_EXPENSES',
  'INCOME_TAXES',
  'NET_INCOME',
]

/**
 * 사업연도 기간입니다. 사업연도 이름은 끝나는 해이고, 종료 월은 세무 설정의 `fiscalYearEndMonth`입니다.
 * 법인세 확정 신고 건의 기간과 같은 계산입니다.
 *
 * @example
 * ```ts
 * fiscalPeriod(2026, 3) // { start: '2025-04-01', end: '2026-03-31' }
 * ```
 */
export function fiscalPeriod(fiscalYear: number, fiscalYearEndMonth: number): FiscalPeriod {
  const 종료월 = `${String(fiscalYear).padStart(4, '0')}-${String(fiscalYearEndMonth).padStart(2, '0')}`
  return { start: `${addMonths(종료월, -11)}-01`, end: lastDayOfMonth(종료월) }
}

/**
 * 결산 스냅샷의 결산 기준일과 월 목록이 맞는지 봅니다. 모든 결산 보고서가 같이 씁니다. 맞으면 `undefined`입니다.
 *
 * - 결산 기준일은 사업연도 안이고 오늘보다 늦지 않습니다. 아직 오지 않은 날까지 결산할 수 없습니다
 * - 결산 기준일은 월말입니다. 월별 값을 받으므로, 달 중간을 기준일로 두면 그 달의 기준일 뒤 거래가 들었는지 알 수 없습니다
 * - 월별 값은 사업연도 첫 달부터 결산 기준일이 속한 달까지 빠짐없이 한 번씩입니다. 결산은 기간 전체를 닫으므로
 *   중간 달이 빠진 스냅샷은 누계와 잔액이 틀립니다
 */
export function validateSnapshotMonths(
  upload: { closedThrough: string; months: ReadonlyArray<{ month: string }> },
  period: FiscalPeriod,
  today: string,
): SettlementSnapshotViolation | undefined {
  if (upload.closedThrough < period.start || upload.closedThrough > period.end) {
    return { reason: 'CLOSED_THROUGH_OUT_OF_PERIOD', field: 'closedThrough' }
  }
  if (upload.closedThrough > today) return { reason: 'CLOSED_THROUGH_IN_FUTURE', field: 'closedThrough' }
  if (upload.closedThrough !== lastDayOfMonth(upload.closedThrough.slice(0, 7))) {
    return { reason: 'CLOSED_THROUGH_NOT_MONTH_END', field: 'closedThrough' }
  }

  const 첫달 = period.start.slice(0, 7)
  const 마지막달 = upload.closedThrough.slice(0, 7)
  const 본달 = new Set<string>()
  for (const [index, month] of upload.months.entries()) {
    const field = `months[${index}].month`
    if (month.month < 첫달 || month.month > 마지막달) return { reason: 'MONTH_OUT_OF_RANGE', field }
    if (본달.has(month.month)) return { reason: 'MONTH_DUPLICATED', field }
    본달.add(month.month)
  }
  for (let month = 첫달; month <= 마지막달; month = addMonths(month, 1)) {
    if (!본달.has(month)) return { reason: 'MONTH_MISSING', field: 'months' }
  }
  return undefined
}

/**
 * 손익 스냅샷 업로드가 맞는지 봅니다. 맞으면 `undefined`, 아니면 처음 걸린 위반 하나입니다.
 *
 * - 결산 기준일과 월 목록은 {@link validateSnapshotMonths}가 봅니다
 * - 계정 이름은 비어 있지 않고 섹션 안에서 겹치지 않습니다. 이름이 응답과 화면에서 계정을 가르는 키입니다
 * - 계정이 있으면 섹션 합계는 계정 금액의 합과 같습니다. 줄이는 계정(매출원가의 기말재고액 등)은 음수로 적습니다
 *
 * 금액의 부호는 보지 않습니다. 영업외비용 환입이나 법인세 환급처럼 섹션 합계가 음수일 수 있습니다.
 *
 * @example
 * ```ts
 * validateProfitLossUpload({ closedThrough: '2026-12-31', months: [] }, fiscalPeriod(2026, 3), '2026-11-11')
 * // { reason: 'CLOSED_THROUGH_OUT_OF_PERIOD', field: 'closedThrough' }
 * ```
 */
export function validateProfitLossUpload(
  upload: ProfitLossUpload,
  period: FiscalPeriod,
  today: string,
): SettlementSnapshotViolation | undefined {
  const periodViolation = validateSnapshotMonths(upload, period, today)
  if (periodViolation !== undefined) return periodViolation

  for (const [index, month] of upload.months.entries()) {
    for (const section of PROFIT_LOSS_INPUT_SECTIONS) {
      const violation = 섹션위반(month.sections[section], `months[${index}].sections.${section}`)
      if (violation !== undefined) return violation
    }
  }
  return undefined
}

function 섹션위반(section: ProfitLossSectionAmount, field: string): SettlementSnapshotViolation | undefined {
  const 이름들 = new Set<string>()
  for (const [index, account] of section.accounts.entries()) {
    const 이름 = account.name.trim()
    if (이름 === '') return { reason: 'ACCOUNT_NAME_BLANK', field: `${field}.accounts[${index}].name` }
    if (이름들.has(이름)) return { reason: 'ACCOUNT_DUPLICATED', field: `${field}.accounts[${index}].name` }
    이름들.add(이름)
  }
  if (section.accounts.length > 0 && sumAmounts(section.accounts) !== section.amount) {
    return { reason: 'SECTION_TOTAL_MISMATCH', field: `${field}.amount` }
  }
  return undefined
}

function sumAmounts(accounts: ReadonlyArray<SettlementAccountAmount>): number {
  return accounts.reduce((sum, account) => sum + account.amount, 0)
}

/** 계산 섹션입니다. 계정은 없습니다. */
function 계산(amount: number): ProfitLossSectionAmount {
  return { amount, accounts: [] }
}

/**
 * 담당자가 올린 섹션으로 계산 섹션을 채웁니다.
 *
 * ```text
 * 매출총이익 = 매출액 − 매출원가
 * 영업이익 = 매출총이익 − 판매비와관리비
 * 당기순이익 = 영업이익 + 영업외수익 − 영업외비용 − 법인세등(개인은 소득세등)
 * ```
 *
 * 계정 이름은 앞뒤 공백을 지운 값으로 둡니다.
 */
export function deriveProfitLossMonth(input: ProfitLossInputMonth): ProfitLossMonth {
  const s = input.sections
  const 섹션 = (section: ProfitLossInputSection): ProfitLossSectionAmount => ({
    amount: s[section].amount,
    accounts: s[section].accounts.map((account) => ({ name: account.name.trim(), amount: account.amount })),
  })
  const 매출총이익 = s.REVENUE.amount - s.COST_OF_SALES.amount
  const 영업이익 = 매출총이익 - s.SELLING_AND_ADMINISTRATIVE_EXPENSES.amount
  const 당기순이익 = 영업이익 + s.NON_OPERATING_INCOME.amount - s.NON_OPERATING_EXPENSES.amount - s.INCOME_TAXES.amount
  return {
    month: input.month,
    sections: {
      REVENUE: 섹션('REVENUE'),
      COST_OF_SALES: 섹션('COST_OF_SALES'),
      GROSS_PROFIT: 계산(매출총이익),
      SELLING_AND_ADMINISTRATIVE_EXPENSES: 섹션('SELLING_AND_ADMINISTRATIVE_EXPENSES'),
      OPERATING_INCOME: 계산(영업이익),
      NON_OPERATING_INCOME: 섹션('NON_OPERATING_INCOME'),
      NON_OPERATING_EXPENSES: 섹션('NON_OPERATING_EXPENSES'),
      INCOME_TAXES: 섹션('INCOME_TAXES'),
      NET_INCOME: 계산(당기순이익),
    },
  }
}

/**
 * 월별 손익을 더해 결산 기준일까지의 누계(손익계산서의 "당기")를 냅니다. 계정은 이름으로 묶고, 처음 나온 순서를 지킵니다.
 */
export function sumProfitLoss(
  months: ReadonlyArray<ProfitLossMonth>,
): Readonly<Record<ProfitLossSection, ProfitLossSectionAmount>> {
  const 누계 = {} as Record<ProfitLossSection, ProfitLossSectionAmount>
  for (const section of PROFIT_LOSS_SECTIONS) {
    const 계정별 = new Map<string, number>()
    let amount = 0
    for (const month of months) {
      amount += month.sections[section].amount
      for (const account of month.sections[section].accounts) {
        계정별.set(account.name, (계정별.get(account.name) ?? 0) + account.amount)
      }
    }
    누계[section] = { amount, accounts: [...계정별].map(([name, total]) => ({ name, amount: total })) }
  }
  return 누계
}
