/** 계좌번호의 숫자만 남깁니다. */
export function accountDigits(accountNumber: string): string {
  return accountNumber.replace(/\D/g, '')
}

/**
 * 응답에 넣는 계좌번호입니다. 끝 4자리만 보이고 나머지는 `*`입니다 (`docs/design/conventions.md`).
 *
 * @example
 * ```ts
 * maskAccountNumber('123-456-789012') // '********9012'
 * ```
 */
export function maskAccountNumber(accountNumber: string): string {
  const digits = accountDigits(accountNumber)
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`
}
