/**
 * 현행 와이어의 키 이름 규칙입니다. 현행 서버는 snake_case로 주고받았고, 클라이언트 인터셉터가 camelCase로 바꿔 썼습니다.
 * BFF는 현행 서버 자리에 서므로 snake_case를 내보내고 받습니다.
 */

/**
 * 하위 키를 바꾸지 않는 현행 키입니다. 급여의 지급·공제 항목처럼 키 자체가 데이터(항목 코드)인 객체입니다.
 *
 * 현행 클라이언트의 `LEGACY_RAW_KEYS`와 같은 목록입니다. 클라이언트는 이 키 뒤에 오는 형제 키의 하위까지 변환을 껐지만,
 * 그것은 클라이언트 인터셉터의 특이점이라 서버 쪽인 BFF는 따라 하지 않습니다.
 */
export const LEGACY_RAW_KEYS: ReadonlySet<string> = new Set(['other_deductions', 'taxable_incomes'])

/** `staySignedIn` → `stay_signed_in`. 이미 snake_case면 그대로입니다. */
export function snakeCase(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}

/** `stay_signed_in` → `staySignedIn`. 이미 camelCase면 그대로입니다. */
export function camelCase(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, letter: string) => letter.toUpperCase())
}

/**
 * 객체·배열을 깊이 돌며 키 이름을 바꿉니다. 값은 바꾸지 않습니다.
 *
 * @param rawKeys 바꾼 뒤의 이름이 여기 있으면 그 키의 하위는 그대로 복사합니다.
 */
export function transformKeys(
  value: unknown,
  rename: (key: string) => string,
  rawKeys: ReadonlySet<string> = LEGACY_RAW_KEYS,
): unknown {
  if (Array.isArray(value)) return value.map((item) => transformKeys(item, rename, rawKeys))
  if (!isPlainObject(value)) return value
  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    const renamed = rename(key)
    result[renamed] = rawKeys.has(renamed) || rawKeys.has(key) ? child : transformKeys(child, rename, rawKeys)
  }
  return result
}

/**
 * 새 API의 필드 경로(`rows[1].basePay`)를 현행 이름(`rows[1].base_pay`)으로 바꿉니다.
 */
export function snakeCasePath(path: string): string {
  return path
    .split('.')
    .map((segment) => snakeCase(segment))
    .join('.')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype
}
