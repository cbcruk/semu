/**
 * 저장 레코드를 JSON 문자열로 바꾸고 되돌립니다. 일반 JSON이 잃는 `Set`, `Map`, `bigint`, `undefined` 필드를 태그로 보존합니다.
 *
 * 태그는 `{ "$set": [...] }`, `{ "$map": [[k, v], ...] }`, `{ "$bigint": "123" }`입니다. 레코드 필드 이름이 `$`로 시작하지 않는다고 가정합니다.
 */

const SET = '$set'
const MAP = '$map'
const BIGINT = '$bigint'

/** 레코드를 JSON 문자열로 바꿉니다. `undefined` 필드는 빠집니다(선택 필드와 같은 뜻). */
export function encodeRecord(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) => {
    if (entry instanceof Set) return { [SET]: [...entry] }
    if (entry instanceof Map) return { [MAP]: [...entry] }
    if (typeof entry === 'bigint') return { [BIGINT]: entry.toString() }
    return entry
  })
}

/** {@link encodeRecord}로 만든 문자열을 되돌립니다. */
export function decodeRecord<T>(text: string): T {
  return JSON.parse(text, (_key, entry: unknown) => {
    if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
      const keys = Object.keys(entry)
      if (keys.length === 1) {
        const tagged = entry as Record<string, unknown>
        if (keys[0] === SET) return new Set(tagged[SET] as unknown[])
        if (keys[0] === MAP) return new Map(tagged[MAP] as Array<[unknown, unknown]>)
        if (keys[0] === BIGINT) return BigInt(tagged[BIGINT] as string)
      }
    }
    return entry
  }) as T
}
