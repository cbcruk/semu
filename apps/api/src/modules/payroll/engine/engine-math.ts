import type { LinearBracket, PerUnitBracket, RoundingUnit } from './rate-table.types.ts'

const PPM = 1_000_000n

/** 금액이 안전한 정수(원)인지 확인합니다. 아니면 `RangeError`입니다. */
export function assertWon(amount: number): void {
  if (!Number.isSafeInteger(amount)) throw new RangeError(`Amount must be a safe integer: ${amount}`)
}

/**
 * 0 이상의 정수로 `floor(a × b ÷ c)`를 정밀도 손실 없이 계산합니다.
 *
 * @throws {RangeError} 음수·소수가 있거나 `c`가 0일 때
 */
export function mulDiv(a: number, b: number, c: number): number {
  if (![a, b, c].every((value) => Number.isSafeInteger(value) && value >= 0) || c === 0) {
    throw new RangeError(`mulDiv expects non-negative integers and a positive divisor: ${a}, ${b}, ${c}`)
  }
  return Number((BigInt(a) * BigInt(b)) / BigInt(c))
}

/** 0 이상의 금액에 ppm 요율을 곱하고 원 미만을 버립니다. 음수 요율은 부호를 붙여 돌려줍니다. */
export function applyPpm(amount: number, ratePpm: number): number {
  assertWon(amount)
  if (amount <= 0) return 0
  const sign = ratePpm < 0 ? -1 : 1
  return sign * Number((BigInt(amount) * BigInt(Math.abs(ratePpm))) / PPM)
}

/** 0 이상의 금액을 절사 단위의 배수로 내립니다(원 미만·10원 미만 절사). */
export function truncateTo(amount: number, unit: RoundingUnit): number {
  assertWon(amount)
  if (amount <= 0) return 0
  return amount - (amount % unit)
}

/** 구간별 선형식을 `x`에서 계산하고 원 미만을 버립니다. */
export function evaluateLinear(brackets: readonly LinearBracket[], x: number): number {
  const bracket = brackets.find((candidate) => candidate.upTo === null || x <= candidate.upTo)
  if (bracket === undefined) throw new RangeError(`No bracket covers ${x}`)
  return bracket.base + applyPpm(Math.max(0, x - bracket.over), bracket.ratePpm)
}

/** 단위당 계단식을 `x`에서 계산합니다. 근속연수공제처럼 연 단위 공제에 씁니다. */
export function evaluatePerUnit(brackets: readonly PerUnitBracket[], x: number): number {
  const bracket = brackets.find((candidate) => candidate.upTo === null || x <= candidate.upTo)
  if (bracket === undefined) throw new RangeError(`No bracket covers ${x}`)
  return bracket.base + Math.max(0, x - bracket.over) * bracket.perUnit
}

/** 계산식 표시용으로 금액에 천 단위 구분 기호를 넣습니다. */
export function formatWon(amount: number): string {
  return amount.toLocaleString('en-US')
}

/** 계산식 표시용으로 ppm 요율을 백분율로 씁니다. 예: `3.595%` */
export function formatPpm(ratePpm: number): string {
  return `${(ratePpm / 10_000).toString()}%`
}

/** 분을 계산식 표시용 시간으로 씁니다. 예: 90분은 `1.5` */
export function formatHours(minutes: number): string {
  return (minutes / 60).toString()
}

/** 숫자 목록의 합입니다. */
export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}
