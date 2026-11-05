/**
 * Extracts the VAT portion of a VAT-inclusive total in whole won.
 *
 * The supply amount is `floor(|total| × 10 / 11)` and the VAT is the
 * remainder. The sign is applied afterwards, so a cancellation always
 * mirrors its original sale exactly.
 *
 * @example Splitting a card sale and its cancellation
 * ```ts
 * import { splitVatFromTotal } from './money'
 *
 * splitVatFromTotal(11_000) // 1_000
 * splitVatFromTotal(-11_000) // -1_000
 * ```
 */
export function splitVatFromTotal(total: number): number {
  assertWon(total)
  const absolute = Math.abs(total)
  const vat = absolute - Math.floor((absolute * 10) / 11)
  return total < 0 ? -vat : vat
}

/** Scales an amount by basis points (10000 = 100%), truncating toward zero. */
export function applyBasisPoints(amount: number, basisPoints: number): number {
  assertWon(amount)
  const scaled = Math.floor((Math.abs(amount) * basisPoints) / 10_000)
  return amount < 0 ? -scaled : scaled
}

/**
 * Asserts that a value is a safe integer amount of won.
 *
 * @throws {RangeError} When the value is fractional or outside the safe integer range.
 */
export function assertWon(amount: number): void {
  if (!Number.isSafeInteger(amount)) throw new RangeError(`Amount must be a safe integer: ${amount}`)
}
