import { createHash } from 'node:crypto'

/** `Idempotency-Key`를 기억하는 시간입니다. 지나면 같은 키도 새 요청으로 처리합니다(conventions.md 멱등성). */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000

/** 기억한 키가 `now`에 만료됐는지 봅니다. `createdAt`은 키를 처음 받은 시각(ISO)입니다. */
export function idempotencyExpired(createdAt: string, now: number): boolean {
  return now - Date.parse(createdAt) >= IDEMPOTENCY_TTL_MS
}

/**
 * 요청 본문의 지문입니다. 객체 키를 정렬한 JSON의 SHA-256(hex)이라 키 순서·공백이 달라도 같은 본문이면 같습니다.
 * 배열 순서는 응답 순서를 정하므로 그대로 둡니다.
 */
export function requestFingerprint(body: unknown): string {
  return createHash('sha256').update(canonicalJson(body)).digest('hex')
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}
