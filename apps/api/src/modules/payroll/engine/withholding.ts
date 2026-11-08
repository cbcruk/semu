import { applyPpm, formatPpm, formatWon, sum, truncateTo } from './engine-math.ts'
import type { NecessaryExpense, TraceEntry } from './engine.types.ts'
import type { PayrollRateTable } from './rate-table.types.ts'
import { localIncomeTaxOf } from './wage-income-tax.ts'

/** 지급 한 건에서 원천징수한 소득세와 지방소득세입니다. */
export interface WithholdingResult {
  incomeTax: number
  localIncomeTax: number
  /** 소액부징수나 과세최저한으로 면제됐는지입니다. */
  exempt: boolean
  trace: TraceEntry[]
}

/**
 * 일용근로소득의 원천징수입니다.
 *
 * 일마다 `max(0, 일급 − 150,000)`에 6%를 곱하고 그 55%를 공제합니다(단계마다 원 미만 절사). 행 세액은 10원 미만
 * 절사하고, 1,000원 미만이면 0입니다(소액부징수, 지급 행 단위 판정). `dailyPays`가 없으면 총액을 균등 분할합니다.
 *
 * @example 하루 200,000원씩 5일
 * ```ts
 * withholdDailyWorker(1_000_000, 5, undefined, RATES_2026_01) // { incomeTax: 6_750, localIncomeTax: 670, ... }
 * ```
 */
export function withholdDailyWorker(
  payAmount: number,
  workDays: number,
  dailyPays: readonly number[] | undefined,
  rates: PayrollRateTable,
): WithholdingResult {
  const 일용기준 = rates.dailyWorker
  const 근로일수 = Math.max(1, workDays)
  const 과세표준 =
    dailyPays === undefined
      ? splitEvenly(payAmount, 근로일수).reduce((total, 일급) => total + Math.max(0, 일급 - 일용기준.dailyDeduction), 0)
      : sum(dailyPays.map((일급) => Math.max(0, 일급 - 일용기준.dailyDeduction)))
  const 산출세액 = applyPpm(과세표준, 일용기준.ratePpm)
  const 세액공제 = applyPpm(산출세액, 일용기준.creditPpm)
  const 결정세액 = truncateTo(산출세액 - 세액공제, rates.wageIncomeTax.taxRoundingUnit)
  const 소액부징수임 = 결정세액 < rates.smallAmountExemption
  const 소득세 = 소액부징수임 ? 0 : 결정세액
  return 지방소득세추가(소득세, 소액부징수임, rates, [
    {
      code: 'INCOME_TAX',
      label: '소득세',
      amount: 소득세,
      formula: `(지급액 ${formatWon(payAmount)} − ${formatWon(일용기준.dailyDeduction)} × ${근로일수}일 = ${formatWon(과세표준)}) × ${formatPpm(일용기준.ratePpm)} − 근로소득세액공제 ${formatPpm(일용기준.creditPpm)}${소액부징수임 ? ` → 소액부징수(${formatWon(rates.smallAmountExemption)}원 미만)` : ''}`,
    },
  ])
}

/**
 * 사업소득의 원천징수입니다. 소득세 3%, 지방소득세 0.3%입니다.
 *
 * 소득세는 10원 미만 절사하고, 1,000원 미만이면 0입니다(소액부징수).
 */
export function withholdBusinessIncome(payAmount: number, rates: PayrollRateTable): WithholdingResult {
  const 원천징수세액 = truncateTo(
    applyPpm(payAmount, rates.businessIncome.ratePpm),
    rates.wageIncomeTax.taxRoundingUnit,
  )
  const 소액부징수임 = 원천징수세액 < rates.smallAmountExemption
  const 소득세 = 소액부징수임 ? 0 : 원천징수세액
  return 지방소득세추가(소득세, 소액부징수임, rates, [
    {
      code: 'INCOME_TAX',
      label: '소득세',
      amount: 소득세,
      formula: `${formatWon(payAmount)} × ${formatPpm(rates.businessIncome.ratePpm)}${소액부징수임 ? ` → 소액부징수(${formatWon(rates.smallAmountExemption)}원 미만)` : ''}`,
    },
  ])
}

/** 기타소득의 필요경비입니다. 지급액을 넘지 않습니다. */
export function necessaryExpenseOf(payAmount: number, expense: NecessaryExpense): number {
  const 필요경비 = expense.kind === 'DEEMED' ? applyPpm(payAmount, expense.ratePpm) : expense.amount
  return Math.min(Math.max(0, 필요경비), payAmount)
}

/**
 * 기타소득의 원천징수입니다.
 *
 * `기타소득금액 = 지급액 − 필요경비`. 5만원 이하이면 과세하지 않습니다(과세최저한, 건별). 아니면
 * `기타소득금액 × 20%`(또는 지급사유별 세율)를 10원 미만 절사하고, 1,000원 미만이면 0입니다.
 *
 * @example 필요경비 60%인 1,000,000원
 * ```ts
 * withholdOtherIncome(1_000_000, { kind: 'DEEMED', ratePpm: 600_000 }, undefined, RATES_2026_01)
 * // { incomeTax: 80_000, localIncomeTax: 8_000, ... }
 * ```
 */
export function withholdOtherIncome(
  payAmount: number,
  expense: NecessaryExpense,
  taxRatePpm: number | undefined,
  rates: PayrollRateTable,
): WithholdingResult {
  const 필요경비 = necessaryExpenseOf(payAmount, expense)
  const 기타소득금액 = payAmount - 필요경비
  const 세율ppm = taxRatePpm ?? rates.otherIncome.ratePpm
  const 과세최저한이하인가 = 기타소득금액 <= rates.otherIncome.minimumTaxableIncome
  const 원천징수세액 = 과세최저한이하인가
    ? 0
    : truncateTo(applyPpm(기타소득금액, 세율ppm), rates.wageIncomeTax.taxRoundingUnit)
  const 소액부징수임 = !과세최저한이하인가 && 원천징수세액 < rates.smallAmountExemption
  const 징수하지않음 = 과세최저한이하인가 || 소액부징수임
  const 소득세 = 징수하지않음 ? 0 : 원천징수세액
  const 면제문구 = 과세최저한이하인가
    ? ` → 과세최저한(${formatWon(rates.otherIncome.minimumTaxableIncome)}원 이하)`
    : 소액부징수임
      ? ` → 소액부징수(${formatWon(rates.smallAmountExemption)}원 미만)`
      : ''
  return 지방소득세추가(소득세, 징수하지않음, rates, [
    {
      code: 'NECESSARY_EXPENSE',
      label: '필요경비',
      amount: 필요경비,
      formula: expense.kind === 'DEEMED' ? `${formatWon(payAmount)} × ${formatPpm(expense.ratePpm)}` : '실제 경비',
    },
    {
      code: 'INCOME_TAX',
      label: '소득세',
      amount: 소득세,
      formula: `(${formatWon(payAmount)} − ${formatWon(필요경비)}) × ${formatPpm(세율ppm)}${면제문구}`,
    },
  ])
}

/**
 * 원천징수 뒤 실지급액이 주어진 금액이 되는 지급 총액을 찾습니다(세금공제후 역산).
 *
 * 절사 때문에 실지급액이 같은 총액이 여럿일 수 있어, `실지급액 ÷ (1 − 실효세율)`에 가장 가까운 정확한 값을
 * 고릅니다(967,000 → 999,980이 아니라 1,000,000). 정확한 값이 없으면 실지급액이 목표 이상인 가장 작은 총액입니다.
 */
export function grossUpFromNet(netAmount: number, netOf: (gross: number) => number, effectiveRatePpm: number): number {
  const 추정총액 = Math.round((netAmount * 1_000_000) / Math.max(1, 1_000_000 - effectiveRatePpm))
  let 일치총액: number | undefined
  // 실지급액이 목표를 처음 넘는(가장 작은) 총액
  let 초과최소총액: number | undefined
  for (let 후보총액 = Math.max(netAmount, 추정총액 - 2_000); 후보총액 <= 추정총액 + 2_000; 후보총액 += 1) {
    const 실지급액 = netOf(후보총액)
    if (
      실지급액 === netAmount &&
      (일치총액 === undefined || Math.abs(후보총액 - 추정총액) < Math.abs(일치총액 - 추정총액))
    ) {
      일치총액 = 후보총액
    }
    if (실지급액 > netAmount && 초과최소총액 === undefined) 초과최소총액 = 후보총액
  }
  return 일치총액 ?? 초과최소총액 ?? 추정총액
}

function 지방소득세추가(
  소득세: number,
  징수하지않음: boolean,
  rates: PayrollRateTable,
  trace: TraceEntry[],
): WithholdingResult {
  const 지방소득세 = localIncomeTaxOf(소득세, rates)
  trace.push({
    code: 'LOCAL_INCOME_TAX',
    label: '지방소득세',
    amount: 지방소득세,
    formula: `소득세 ${formatWon(소득세)} × 10%`,
  })
  return { incomeTax: 소득세, localIncomeTax: 지방소득세, exempt: 징수하지않음, trace }
}

function splitEvenly(total: number, days: number): number[] {
  const share = Math.floor(total / days)
  const remainder = total - share * days
  return Array.from({ length: days }, (_, index) => share + (index < remainder ? 1 : 0))
}
