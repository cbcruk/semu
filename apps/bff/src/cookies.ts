/** 현행 세션 쿠키입니다. 값은 BFF 세션을 찾는 불투명 토큰입니다. */
export const SESSION_COOKIE = 'sessionid'

/** 현행 클라이언트가 읽는 CSRF 쿠키입니다. 회사 계정 쪽(`nexus_csrftoken`)과 업무 쪽(`csrftoken`) 클라이언트가 하나씩 씁니다. */
export const CSRF_COOKIES = ['nexus_csrftoken', 'csrftoken'] as const

/** 현행 클라이언트가 CSRF 토큰을 실어 보내는 헤더입니다. */
export const CSRF_HEADERS = ['x-csrftoken', 'x-xsrf-token'] as const

/** `Cookie` 헤더를 이름 → 값으로 읽습니다. 같은 이름이 여러 번 오면 앞의 것을 씁니다. */
export function parseCookies(header: string | null): Map<string, string> {
  const cookies = new Map<string, string>()
  if (header === null) return cookies
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index <= 0) continue
    const name = part.slice(0, index).trim()
    if (!cookies.has(name)) cookies.set(name, part.slice(index + 1).trim())
  }
  return cookies
}

/** `Set-Cookie` 한 줄의 `name=value`만 꺼냅니다. 새 API의 refresh 쿠키를 BFF 세션에 담을 때 씁니다. */
export function cookiePair(setCookie: string | null): string | undefined {
  if (setCookie === null) return undefined
  const pair = setCookie.split(';')[0]?.trim()
  return pair === undefined || pair === '' || pair.endsWith('=') ? undefined : pair
}

/**
 * 현행 세션 쿠키와 CSRF 쿠키를 씁니다. 현행 서버와 같은 속성입니다.
 *
 * "로그인 유지"가 아니면 브라우저 세션 쿠키이고, 서버는 그래도 `expiresAt`에 세션을 끝냅니다.
 */
export function appendSessionCookies(
  headers: Headers,
  input: { token: string; csrfToken: string; staySignedIn: boolean; expiresAt: Date },
): void {
  const persistence = input.staySignedIn ? `; Expires=${input.expiresAt.toUTCString()}` : ''
  headers.append('set-cookie', `${SESSION_COOKIE}=${input.token}; Path=/; HttpOnly; Secure; SameSite=Lax${persistence}`)
  for (const name of CSRF_COOKIES) {
    headers.append('set-cookie', `${name}=${input.csrfToken}; Path=/; Secure; SameSite=Lax${persistence}`)
  }
}

/** 세션·CSRF 쿠키를 지웁니다. */
export function appendClearedSessionCookies(headers: Headers): void {
  for (const name of [SESSION_COOKIE, ...CSRF_COOKIES]) {
    headers.append('set-cookie', `${name}=; Path=/; Max-Age=0; Secure`)
  }
}
