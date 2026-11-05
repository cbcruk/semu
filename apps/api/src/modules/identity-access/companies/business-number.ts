const BUSINESS_NUMBER_WEIGHTS = [1, 3, 7, 1, 3, 7, 1, 3, 5] as const

/**
 * 사업자등록번호에서 하이픈을 빼고 검증 숫자가 맞으면 숫자 10자리를, 아니면 `undefined`를 돌려줍니다.
 *
 * 국세청 검증 숫자 계산은 현행 구현(`legacy/src/modules/platform/platform.utils.ts`)과 같습니다.
 *
 * @example
 * ```ts
 * normalizeBusinessNumber('123-81-45600') // '1238145600'
 * normalizeBusinessNumber('1238145601') // undefined
 * ```
 */
export function normalizeBusinessNumber(value: string): string | undefined {
  const digits = value.replaceAll('-', '')
  return isValidBusinessNumber(digits) ? digits : undefined
}

/** 숫자 10자리 사업자등록번호의 검증 숫자가 맞는지입니다. */
export function isValidBusinessNumber(digits: string): boolean {
  if (!/^\d{10}$/.test(digits)) return false
  const numbers = [...digits].map(Number)
  let sum = BUSINESS_NUMBER_WEIGHTS.reduce((total, weight, index) => total + (numbers[index] ?? 0) * weight, 0)
  sum += Math.floor(((numbers[8] ?? 0) * 5) / 10)
  return (10 - (sum % 10)) % 10 === numbers[9]
}

/** 법인등록번호 13자리(하이픈 허용)의 검증 숫자가 맞는지입니다. */
export function isValidCorporateRegistrationNumber(value: string): boolean {
  const digits = value.replaceAll('-', '')
  if (!/^\d{13}$/.test(digits)) return false
  const numbers = [...digits].map(Number)
  let sum = 0
  for (let index = 0; index < 12; index += 1) sum += (numbers[index] ?? 0) * (index % 2 === 0 ? 1 : 2)
  return (10 - (sum % 10)) % 10 === numbers[12]
}
