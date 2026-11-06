import { LegacyError, legacyErrors } from './legacy-error.ts'

/**
 * 요청 본문을 JSON 객체로 읽습니다.
 *
 * `Content-Type`이 `application/json`이 아니면 415입니다. HTML 폼은 `text/plain`·`application/x-www-form-urlencoded`로
 * 다른 사이트에서도 사전 요청 없이 보낼 수 있으므로, 그런 본문을 JSON으로 읽지 않습니다.
 */
export async function readObject(request: Request): Promise<Record<string, unknown>> {
  const mediaType = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
  if (mediaType !== 'application/json') {
    throw new LegacyError(415, { detail: 'Send the body as application/json.', code: 'UNSUPPORTED_MEDIA_TYPE' })
  }
  const body: unknown = await request.json().catch(() => undefined)
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw legacyErrors.invalidField('non_field_errors', 'Send a JSON object.')
  }
  return body as Record<string, unknown>
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** 현행 서버(zod)와 같은 문구입니다. */
const REQUIRED = 'This field is required.'

/**
 * 현행 요청 본문의 필드를 읽습니다. 현행 서버의 zod 스키마처럼 빠진 값은 기본값으로 채우고, 타입이 틀리면
 * 422 `VALIDATION_FAILED`의 필드 오류로 던집니다. 범위·업무 규칙은 새 API가 검증합니다.
 */
export class LegacyFields {
  constructor(private readonly body: Record<string, unknown>) {}

  /** 필드 값입니다. 없으면 `undefined`입니다. */
  raw(name: string): unknown {
    return this.body[name]
  }

  /** 날짜(`YYYY-MM-DD`)입니다. 빠졌으면 422입니다. */
  date(name: string): string {
    const value = this.optionalDate(name)
    if (value === null) throw legacyErrors.invalidField(name, REQUIRED)
    return value
  }

  /** 날짜이거나 `null`입니다. 빠졌으면 `null`입니다. */
  optionalDate(name: string): string | null {
    const value = this.body[name]
    if (value === undefined || value === null) return null
    if (typeof value !== 'string' || !DATE.test(value)) {
      throw legacyErrors.invalidField(name, 'Enter a date as YYYY-MM-DD.')
    }
    return value
  }

  /** 정해진 값 중 하나입니다. 빠졌으면 `fallback`, `fallback`도 없으면 422입니다. */
  choice<const T extends string>(name: string, values: readonly T[], fallback?: T): T {
    const value = this.body[name]
    if (value === undefined || value === null) {
      if (fallback === undefined) throw legacyErrors.invalidField(name, REQUIRED)
      return fallback
    }
    if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) {
      throw legacyErrors.invalidField(name, 'Invalid value.')
    }
    return value as T
  }

  /** 참·거짓입니다. 빠졌으면 `fallback`입니다. */
  boolean(name: string, fallback: boolean): boolean {
    const value = this.body[name]
    if (value === undefined || value === null) return fallback
    if (typeof value !== 'boolean') throw legacyErrors.invalidField(name, 'Must be a valid boolean.')
    return value
  }

  /** 숫자입니다. 빠졌으면 `fallback`, `fallback`도 없으면 422입니다. */
  number(name: string, fallback?: number): number {
    const value = this.optionalNumber(name)
    if (value !== null) return value
    if (fallback === undefined) throw legacyErrors.invalidField(name, REQUIRED)
    return fallback
  }

  /** 숫자이거나 `null`입니다. */
  optionalNumber(name: string): number | null {
    const value = this.body[name]
    if (value === undefined || value === null) return null
    if (typeof value !== 'number' || !Number.isFinite(value))
      throw legacyErrors.invalidField(name, 'A valid number is required.')
    return value
  }

  /** 문자열이거나 `null`입니다. 빈 문자열은 `null`입니다. */
  optionalText(name: string): string | null {
    const value = this.body[name]
    if (value === undefined || value === null) return null
    if (typeof value !== 'string') throw legacyErrors.invalidField(name, 'Not a valid string.')
    const trimmed = value.trim()
    return trimmed === '' ? null : trimmed
  }

  /**
   * 새 API에 아직 자리가 없는 필드입니다. 기본값(빠짐·`null`·`fallback`)이 아니면 422로 거절합니다.
   * 조용히 버리면 사용자가 넣은 값이 사라지므로, 스테이징에서 드러나게 합니다.
   */
  unsupported(name: string, fallback: unknown = null): void {
    const value = this.body[name]
    if (value === undefined || value === null || value === fallback || value === '') return
    throw legacyErrors.invalidField(name, 'Not supported by the new API yet.')
  }
}
