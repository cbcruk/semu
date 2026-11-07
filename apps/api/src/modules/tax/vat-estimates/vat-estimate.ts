import type { BusinessType } from '../../identity-access/actor.types.ts'
import { addMonths, lastDayOfMonth } from '../../../shared/time/calendar.ts'
import type {
  SalesEvidence,
  SalesSource,
  VatBreakdownEntry,
  VatEstimate,
  VatEstimateInput,
  VatFilingFact,
  VatPeriod,
  VatTrendInput,
  VatTrendPoint,
} from './vat-estimate.types.ts'

/** 100%를 ppm으로 나타낸 값입니다. */
export const FULL_RATIO_PPM = 1_000_000

/** 예상 세액 합계에 넣는 매출 출처입니다. 몰·배달은 PG 결제와 겹칠 수 있어 내역에만 보여 줍니다. */
export const INCLUDED_SALES_SOURCES: ReadonlyArray<SalesSource> = ['TAX_INVOICE', 'CASH_RECEIPT', 'CARD', 'PG']

/**
 * 날짜가 속한 예상 부가세 기간입니다. 법인은 분기, 개인은 반기입니다.
 *
 * @example
 * ```ts
 * vatEstimatePeriod('CORPORATION', '2026-11-05') // { start: '2026-10-01', end: '2026-12-31', unit: 'QUARTER' }
 * ```
 */
export function vatEstimatePeriod(businessType: BusinessType, on: string): VatPeriod {
  const year = Number(on.slice(0, 4))
  const month = Number(on.slice(5, 7))
  if (businessType === 'CORPORATION') {
    const 분기시작월 = `${on.slice(0, 4)}-${String(month - ((month - 1) % 3)).padStart(2, '0')}`
    return { start: `${분기시작월}-01`, end: lastDayOfMonth(addMonths(분기시작월, 2)), unit: 'QUARTER' }
  }
  return vatHalfPeriod(year, month <= 6 ? 1 : 2)
}

/** 부가세 과세기간(1기 1–6월, 2기 7–12월)입니다. */
export function vatHalfPeriod(year: number, half: 1 | 2): VatPeriod {
  return half === 1
    ? { start: `${year}-01-01`, end: `${year}-06-30`, unit: 'HALF' }
    : { start: `${year}-07-01`, end: `${year}-12-31`, unit: 'HALF' }
}

/**
 * 부가세를 포함한 합계에서 세액을 원 단위로 나눕니다.
 *
 * 공급가액은 `floor(|합계| × 10 / 11)`, 세액은 나머지이고 부호는 나중에 붙입니다. 취소 거래의 세액이 원거래와 정확히 대칭입니다.
 */
export function splitVatFromTotal(total: number): number {
  const absolute = Math.abs(total)
  const 세액 = absolute - Math.floor((absolute * 10) / 11)
  return total < 0 ? -세액 : 세액
}

/** 금액에 ppm 비율을 곱하고 0 쪽으로 버립니다. */
export function applyRatePpm(amount: number, ratePpm: number): number {
  const scaled = Math.floor((Math.abs(amount) * ratePpm) / FULL_RATIO_PPM)
  return amount < 0 ? -scaled : scaled
}

/** 매출 한 건의 세액입니다. 원천 세액이 있으면 그대로, 없으면 합계에서 나눠 카드 과세 비율을 곱합니다. */
export function salesVatOf(row: SalesEvidence, taxableCardRatioPpm: number): number {
  if (row.vatAmount !== null) return row.vatAmount
  return applyRatePpm(splitVatFromTotal(row.totalAmount), taxableCardRatioPpm)
}

/** `dedupeGroup`마다 처음 나온 한 건만 남깁니다. 묶음이 없는 건은 모두 남깁니다. */
export function dedupeSales(rows: ReadonlyArray<SalesEvidence>): SalesEvidence[] {
  const seen = new Set<string>()
  return rows.filter((row) => {
    if (row.dedupeGroup === null) return true
    if (seen.has(row.dedupeGroup)) return false
    seen.add(row.dedupeGroup)
    return true
  })
}

/**
 * 수집된 증빙으로 기간의 예상 부가세를 계산합니다.
 *
 * 매출세액은 합계 대상 출처를 `dedupeGroup`마다 한 번씩 더하고, 매입세액은 공제 대상만 더합니다.
 * 미분류 매입은 빼고 건수만 셉니다. 그래서 예상 세액은 높게 나오는 쪽으로 틀립니다.
 */
export function estimateVat(input: VatEstimateInput): VatEstimate {
  /** 시작일·종료일 그날 포함입니다. */
  const 기간안인가 = (date: string): boolean => date >= input.period.start && date <= input.period.end
  const breakdown = new Map<string, VatBreakdownEntry>()
  const 출처별내역 = (side: VatBreakdownEntry['side'], source: VatBreakdownEntry['source'], 합계포함임: boolean) => {
    const key = `${side}:${source}`
    let 내역 = breakdown.get(key)
    if (내역 === undefined) {
      내역 = { side, source, vatAmount: 0, includedInTotal: 합계포함임, lastSyncedAt: null }
      breakdown.set(key, 내역)
    }
    return 내역
  }

  let outputTax = 0
  let cardSplitEstimated = false
  for (const row of dedupeSales(input.sales.filter((sale) => 기간안인가(sale.issuedOn)))) {
    const 합계포함임 = INCLUDED_SALES_SOURCES.includes(row.source)
    const 세액 = salesVatOf(row, input.taxableCardRatioPpm)
    const 내역 = 출처별내역('SALES', row.source, 합계포함임)
    내역.vatAmount += 세액
    내역.lastSyncedAt = latest(내역.lastSyncedAt, row.syncedAt)
    if (합계포함임) outputTax += 세액
    if (합계포함임 && row.vatAmount === null) cardSplitEstimated = true
  }

  let inputTax = 0
  let nonDeductibleCount = 0
  let unclassifiedCount = 0
  for (const row of input.purchases.filter((purchase) => 기간안인가(purchase.issuedOn))) {
    const 내역 = 출처별내역('PURCHASE', row.source, true)
    내역.lastSyncedAt = latest(내역.lastSyncedAt, row.syncedAt)
    if (row.deductible === true) {
      내역.vatAmount += row.vatAmount
      inputTax += row.vatAmount
    } else if (row.deductible === false) {
      nonDeductibleCount++
    } else {
      unclassifiedCount++
    }
  }

  return {
    period: input.period,
    outputTax,
    inputTax,
    estimatedTax: outputTax - inputTax,
    cardSplitEstimated,
    breakdown: [...breakdown.values()],
    excluded: { nonDeductibleCount, unclassifiedCount },
  }
}

/**
 * 과세기간의 확정 부가세입니다. 확정 신고 건이 `FILED`·`SETTLED`일 때만 있고, 아니면 `null`입니다.
 *
 * 그 기간 안의 예정·확정 신고 건 납부 세액을 더합니다. 예정고지 금액은 넣지 않습니다.
 */
export function confirmedVat(period: VatPeriod, filings: ReadonlyArray<VatFilingFact>): number | null {
  const 신고완료인가 = (filing: VatFilingFact): boolean => filing.status === 'FILED' || filing.status === 'SETTLED'
  const 과세기간안인가 = (filing: VatFilingFact): boolean =>
    filing.periodStart >= period.start && filing.periodEnd <= period.end
  const 확정신고완료임 = filings.some(
    (filing) => filing.kind === 'FINAL' && 신고완료인가(filing) && filing.periodEnd === period.end,
  )
  if (!확정신고완료임) return null
  return filings
    .filter(
      (filing) =>
        (filing.kind === 'PRELIMINARY' || filing.kind === 'FINAL') && 신고완료인가(filing) && 과세기간안인가(filing),
    )
    .reduce((합계, filing) => 합계 + (filing.payableAmount ?? 0), 0)
}

/**
 * 과세기간(반기)마다 부가세 하나씩, 올해까지 `years`해 동안의 추이입니다. 아직 시작하지 않은 반기는 뺍니다.
 *
 * 세무 기장 고객은 확정 신고한 반기에 신고 세액을 쓰고, 그 밖에는 증빙으로 계산한 예상 세액을 씁니다.
 * 진행 중인 반기의 예상 세액은 오늘까지의 증빙으로 계산합니다.
 */
export function vatTrend(input: VatTrendInput): VatTrendPoint[] {
  const 올해 = Number(input.today.slice(0, 4))
  const 추이: VatTrendPoint[] = []
  for (let year = 올해 - input.years + 1; year <= 올해; year++) {
    for (const half of [1, 2] as const) {
      const 과세기간 = vatHalfPeriod(year, half)
      if (과세기간.start > input.today) continue
      const 확정세액 = input.hasTaxationPlan ? confirmedVat(과세기간, input.filings) : null
      if (확정세액 !== null) {
        추이.push({ year, half, amount: 확정세액, source: 'CONFIRMED' })
        continue
      }
      const 계산종료일 = 과세기간.end < input.today ? 과세기간.end : input.today
      추이.push({ year, half, amount: input.estimate({ ...과세기간, end: 계산종료일 }), source: 'ESTIMATED' })
    }
  }
  return 추이
}

function latest(current: string | null, candidate: string): string {
  return current === null || candidate > current ? candidate : current
}
