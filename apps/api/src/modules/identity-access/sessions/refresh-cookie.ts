import { createHash, randomBytes } from 'node:crypto'

/** refresh token 쿠키 이름입니다. */
export const REFRESH_COOKIE = 'semu_refresh'

/** refresh 쿠키를 보내는 경로입니다. 인증 엔드포인트에만 실리고 다른 API 요청에는 실리지 않습니다. */
export const REFRESH_COOKIE_PATH = '/v1/auth'

/** 추측할 수 없는 URL 안전 비밀을 만듭니다. */
export function randomSecret(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

/** 비밀은 해시로만 저장합니다. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** `Set-Cookie` 값을 만듭니다. `maxAgeSeconds`가 0이면 쿠키를 지웁니다. */
export function refreshCookie(token: string, maxAgeSeconds: number): string {
  return [
    `${REFRESH_COOKIE}=${token}`,
    `Path=${REFRESH_COOKIE_PATH}`,
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
  ].join('; ')
}

/** `Cookie` 헤더에서 refresh token을 꺼냅니다. */
export function readRefreshCookie(header: string | undefined): string | undefined {
  if (header === undefined) return undefined
  for (const part of header.split(';')) {
    const [name, ...value] = part.trim().split('=')
    if (name === REFRESH_COOKIE && value.length > 0) return value.join('=')
  }
  return undefined
}

/** refresh token은 `<sessionId>.<secret>`입니다. 세션을 찾는 부분과 검증하는 부분을 나눕니다. */
export function splitRefreshToken(token: string): { sessionId: string; secret: string } | undefined {
  const dot = token.indexOf('.')
  if (dot <= 0 || dot === token.length - 1) return undefined
  return { sessionId: token.slice(0, dot), secret: token.slice(dot + 1) }
}
