/**
 * 저장 레코드를 JSON 문자열로 바꾸고 되돌립니다. 일반 JSON이 잃는 `Set`, `Map`, `bigint`를 태그로 보존합니다.
 *
 * - 태그는 키 하나짜리 객체 `{ "$set": [...] }`, `{ "$map": [[k, v], ...] }`, `{ "$bigint": "123" }`입니다
 * - 레코드에 원래 있던 `$`로 시작하는 키(예: 클라이언트가 보낸 연동 키 이름)는 `$`를 하나 더 붙여 저장하고 읽을 때 뗍니다.
 *   그래서 사용자 데이터가 태그로 잘못 풀리지 않습니다
 * - `undefined` 필드는 빠집니다(선택 필드와 같은 뜻)
 */

const SET = '$set'
const MAP = '$map'
const BIGINT = '$bigint'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** 레코드를 JSON 문자열로 바꿉니다. */
export function encodeRecord(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) => {
    if (entry instanceof Set) return { [SET]: [...entry] }
    if (entry instanceof Map) return { [MAP]: [...entry] }
    if (typeof entry === 'bigint') return { [BIGINT]: entry.toString() }
    if (isPlainObject(entry) && Object.keys(entry).some((name) => name.startsWith('$'))) {
      return Object.fromEntries(
        Object.entries(entry).map(([name, inner]) => [name.startsWith('$') ? `$${name}` : name, inner]),
      )
    }
    return entry
  })
}

/** {@link encodeRecord}로 만든 문자열을 되돌립니다. */
export function decodeRecord<T>(text: string): T {
  return JSON.parse(text, (_key, entry: unknown) => {
    if (!isPlainObject(entry)) return entry
    const names = Object.keys(entry)
    if (names.length === 1) {
      if (names[0] === SET) return new Set(entry[SET] as unknown[])
      if (names[0] === MAP) return new Map(entry[MAP] as Array<[unknown, unknown]>)
      if (names[0] === BIGINT) return BigInt(entry[BIGINT] as string)
    }
    if (!names.some((name) => name.startsWith('$$'))) return entry
    return Object.fromEntries(
      Object.entries(entry).map(([name, inner]) => [name.startsWith('$$') ? name.slice(1) : name, inner]),
    )
  }) as T
}
