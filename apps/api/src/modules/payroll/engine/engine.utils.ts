import { assertWon } from '../../../lib/money'
import type { LinearBracket, PerUnitBracket, RoundingUnit } from './rate-table.types'

const PPM = 1_000_000n

/**
 * Computes `floor(a × b / c)` for non-negative integers without losing precision.
 *
 * @throws {RangeError} When an operand is negative, fractional or `c` is zero.
 */
export function mulDiv(a: number, b: number, c: number): number {
  if (![a, b, c].every((value) => Number.isSafeInteger(value) && value >= 0) || c === 0) {
    throw new RangeError(`mulDiv expects non-negative integers and a positive divisor: ${a}, ${b}, ${c}`)
  }
  return Number((BigInt(a) * BigInt(b)) / BigInt(c))
}

/** Multiplies a non-negative won amount by a rate in ppm, truncating below one won. */
export function applyPpm(amount: number, ratePpm: number): number {
  assertWon(amount)
  if (amount <= 0) return 0
  const sign = ratePpm < 0 ? -1 : 1
  return sign * Number((BigInt(amount) * BigInt(Math.abs(ratePpm))) / PPM)
}

/** Truncates a non-negative amount down to a multiple of the rounding unit (원 단위 / 10원 미만 절사). */
export function truncateTo(amount: number, unit: RoundingUnit): number {
  assertWon(amount)
  if (amount <= 0) return 0
  return amount - (amount % unit)
}

/** Evaluates a piecewise-linear schedule at `x`, truncating to whole won. */
export function evaluateLinear(brackets: readonly LinearBracket[], x: number): number {
  const bracket = brackets.find((candidate) => candidate.upTo === null || x <= candidate.upTo)
  if (bracket === undefined) throw new RangeError(`No bracket covers ${x}`)
  return bracket.base + applyPpm(Math.max(0, x - bracket.over), bracket.ratePpm)
}

/** Evaluates a per-unit schedule at `x`, such as 근속연수공제 by years of service. */
export function evaluatePerUnit(brackets: readonly PerUnitBracket[], x: number): number {
  const bracket = brackets.find((candidate) => candidate.upTo === null || x <= candidate.upTo)
  if (bracket === undefined) throw new RangeError(`No bracket covers ${x}`)
  return bracket.base + Math.max(0, x - bracket.over) * bracket.perUnit
}

/** Formats a won amount with thousands separators for calculation traces. */
export function formatWon(amount: number): string {
  return amount.toLocaleString('en-US')
}

/** Formats a ppm rate as a percentage for calculation traces, such as `3.595%`. */
export function formatPpm(ratePpm: number): string {
  return `${(ratePpm / 10_000).toString()}%`
}

/** Converts decimal hours to whole minutes. */
export function toMinutes(hours: number): number {
  return Math.round(hours * 60)
}

/** Converts a decimal multiplier such as `1.5` to hundredths. */
export function toHundredths(multiplier: number): number {
  return Math.round(multiplier * 100)
}

/** Sums a list of numbers. */
export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}
