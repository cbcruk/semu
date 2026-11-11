import type {
  BalanceSheetGroup,
  BalanceSheetInputMonth,
  BalanceSheetMonth,
  BalanceSheetRatios,
  BalanceSheetUpload,
  CumulativeProfitLoss,
  FiscalPeriod,
  ProfitLossMonth,
  ProfitLossSectionAmount,
  SettlementSnapshotViolation,
} from './settlement-report.types.ts'
import { validateSectionAccounts, validateSnapshotMonths } from './settlement-rules.ts'

/** 재무상태표 구분입니다. 표의 순서(자산 → 부채 → 자본)입니다. */
export const BALANCE_SHEET_GROUPS: ReadonlyArray<BalanceSheetGroup> = [
  'CURRENT_ASSETS',
  'NON_CURRENT_ASSETS',
  'CURRENT_LIABILITIES',
  'NON_CURRENT_LIABILITIES',
  'CAPITAL_STOCK',
  'CAPITAL_SURPLUS',
  'CAPITAL_ADJUSTMENTS',
  'ACCUMULATED_OTHER_COMPREHENSIVE_INCOME',
  'RETAINED_EARNINGS',
]

const 자산구분: ReadonlyArray<BalanceSheetGroup> = ['CURRENT_ASSETS', 'NON_CURRENT_ASSETS']
const 부채구분: ReadonlyArray<BalanceSheetGroup> = ['CURRENT_LIABILITIES', 'NON_CURRENT_LIABILITIES']
const 자본구분: ReadonlyArray<BalanceSheetGroup> = [
  'CAPITAL_STOCK',
  'CAPITAL_SURPLUS',
  'CAPITAL_ADJUSTMENTS',
  'ACCUMULATED_OTHER_COMPREHENSIVE_INCOME',
  'RETAINED_EARNINGS',
]

function 구분합(month: BalanceSheetInputMonth, groups: ReadonlyArray<BalanceSheetGroup>): number {
  return groups.reduce((sum, group) => sum + month.groups[group].amount, 0)
}

/**
 * 재무상태표 스냅샷 업로드가 맞는지 봅니다. 맞으면 `undefined`, 아니면 처음 걸린 위반 하나입니다.
 *
 * - 결산 기준일과 월 목록은 {@link validateSnapshotMonths}가 봅니다
 * - 구분마다 계정 규칙은 손익계산서와 같습니다({@link validateSectionAccounts})
 * - 달마다 자산 총계 = 부채 총계 + 자본 총계입니다. 재무상태표의 등식이라 어긋나면 올린 숫자가 잘못된 것입니다
 * - 재고자산과 매출채권은 유동자산의 일부라 0 이상이고, 둘의 합이 유동자산을 넘지 않습니다
 *
 * 구분 금액의 부호는 보지 않습니다. 결손이 쌓이면 이익잉여금과 자본 총계가 음수(자본잠식)일 수 있습니다.
 */
export function validateBalanceSheetUpload(
  upload: BalanceSheetUpload,
  period: FiscalPeriod,
  today: string,
): SettlementSnapshotViolation | undefined {
  const periodViolation = validateSnapshotMonths(upload, period, today)
  if (periodViolation !== undefined) return periodViolation

  for (const [index, month] of upload.months.entries()) {
    for (const group of BALANCE_SHEET_GROUPS) {
      const violation = validateSectionAccounts(month.groups[group], `months[${index}].groups.${group}`)
      if (violation !== undefined) return violation
    }
    if (구분합(month, 자산구분) !== 구분합(month, 부채구분) + 구분합(month, 자본구분)) {
      return { reason: 'BALANCE_SHEET_UNBALANCED', field: `months[${index}]` }
    }
    const 유동자산 = month.groups.CURRENT_ASSETS.amount
    if (month.inventories < 0 || month.tradeReceivables < 0 || month.inventories + month.tradeReceivables > 유동자산) {
      return { reason: 'CURRENT_ASSET_COMPONENT_INVALID', field: `months[${index}]` }
    }
  }
  return undefined
}

/**
 * 분자/분모를 ppm(1 = 1,000,000)으로 냅니다. 0에서 먼 쪽으로 반올림하고, 분모가 0이면 `null`입니다.
 * 원 단위 금액에 1,000,000을 곱하면 안전한 정수 범위를 넘을 수 있어 BigInt로 셉니다.
 *
 * @example
 * ```ts
 * ratioPpm(1, 3) // 333_333
 * ratioPpm(-1, 8) // -125_000
 * ratioPpm(5, 0) // null
 * ```
 */
export function ratioPpm(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null
  const scaled = BigInt(numerator) * 1_000_000n
  const divisor = BigInt(denominator)
  const negative = scaled < 0n !== divisor < 0n
  const absScaled = scaled < 0n ? -scaled : scaled
  const absDivisor = divisor < 0n ? -divisor : divisor
  const rounded = (absScaled * 2n + absDivisor) / (absDivisor * 2n)
  return Number(negative ? -rounded : rounded)
}

/**
 * 손익계산서 월별 값으로 달마다 사업연도 첫 달부터의 손익 누계를 냅니다. 재무상태표 비율의 분자입니다.
 */
export function cumulativeProfitLoss(
  months: ReadonlyArray<ProfitLossMonth>,
): ReadonlyMap<string, CumulativeProfitLoss> {
  const 누계 = new Map<string, CumulativeProfitLoss>()
  let revenue = 0
  let netIncome = 0
  for (const month of months.toSorted((a, b) => a.month.localeCompare(b.month))) {
    revenue += month.sections.REVENUE.amount
    netIncome += month.sections.NET_INCOME.amount
    누계.set(month.month, { revenue, netIncome })
  }
  return 누계
}

/**
 * 한 달 재무상태표에 총계와 재무 비율을 채웁니다. 비율은 원본 화면의 산식 그대로이고, 평균 잔액이나 연환산을 쓰지 않습니다.
 *
 * ```text
 * 자기자본비율 = 자본 / 자산           부채비율 = 부채 / 자본           유동비율 = 유동자산 / 유동부채
 * 총자산순이익률(ROA) = 누적 당기순이익 / 자산      자기자본순이익률(ROE) = 누적 당기순이익 / 자본
 * 총자산회전율 = 누적 매출액 / 자산    재고자산회전율 = 누적 매출액 / 재고자산    매출채권회전율 = 누적 매출액 / 매출채권
 * ```
 *
 * 계정 이름은 손익계산서처럼 앞뒤 공백을 지운 값으로 둡니다.
 *
 * 누적은 같은 사업연도 손익계산서의 첫 달부터 그 달까지입니다. 그 달의 손익이 없으면(`cumulative`가 없음) 손익을 쓰는 비율은 `null`입니다.
 */
export function deriveBalanceSheetMonth(
  input: BalanceSheetInputMonth,
  cumulative: CumulativeProfitLoss | undefined,
): BalanceSheetMonth {
  const assets = 구분합(input, 자산구분)
  const liabilities = 구분합(input, 부채구분)
  const equity = 구분합(input, 자본구분)
  const 손익비율 = (pick: (value: CumulativeProfitLoss) => number, denominator: number) =>
    cumulative === undefined ? null : ratioPpm(pick(cumulative), denominator)
  const ratios: BalanceSheetRatios = {
    equityRatioPpm: ratioPpm(equity, assets),
    debtRatioPpm: ratioPpm(liabilities, equity),
    currentRatioPpm: ratioPpm(input.groups.CURRENT_ASSETS.amount, input.groups.CURRENT_LIABILITIES.amount),
    returnOnAssetsPpm: 손익비율((value) => value.netIncome, assets),
    returnOnEquityPpm: 손익비율((value) => value.netIncome, equity),
    totalAssetTurnoverPpm: 손익비율((value) => value.revenue, assets),
    inventoryTurnoverPpm: 손익비율((value) => value.revenue, input.inventories),
    receivablesTurnoverPpm: 손익비율((value) => value.revenue, input.tradeReceivables),
  }
  const 다듬은구분 = {} as Record<BalanceSheetGroup, ProfitLossSectionAmount>
  for (const group of BALANCE_SHEET_GROUPS) {
    const { amount, accounts } = input.groups[group]
    다듬은구분[group] = {
      amount,
      accounts: accounts.map((account) => ({ name: account.name.trim(), amount: account.amount })),
    }
  }
  return {
    ...input,
    groups: 다듬은구분,
    totals: { assets, liabilities, equity, liabilitiesAndEquity: liabilities + equity },
    ratios,
  }
}
