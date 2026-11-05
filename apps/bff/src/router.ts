import type { BffDeps } from './upstream.ts'

/** 라우트가 받는 요청 정보입니다. */
export interface RouteContext {
  request: Request
  url: URL
  params: Readonly<Record<string, string>>
  deps: BffDeps
}

/** 로그인한 요청입니다. 세션 자체가 아니라 키만 넘겨, 라우트가 늘 자물쇠 안에서 최신 세션을 읽게 합니다. */
export interface SignedInContext extends RouteContext {
  sessionId: string
}

/** 현행 경로 하나입니다. */
export type Route =
  | { method: string; path: string; auth: false; handle: (context: RouteContext) => Promise<Response> }
  | { method: string; path: string; auth: true; handle: (context: SignedInContext) => Promise<Response> }

/** 경로를 찾은 결과입니다. */
export interface Match {
  route: Route
  params: Record<string, string>
}

/**
 * 현행 경로 표입니다. `:name`은 경로 변수이고, 현행 Django식 끝 슬래시는 있어도 없어도 됩니다.
 * 앞에 둔 경로가 먼저 맞습니다(`count-by-status`를 `:employeeId`보다 앞에).
 */
export function makeRouter(routes: readonly Route[]): (method: string, pathname: string) => Match | undefined {
  const compiled = routes.map((route) => {
    const names: string[] = []
    const source = route.path.replace(/:([A-Za-z]+)/g, (_, name: string) => {
      names.push(name)
      return '([^/]+)'
    })
    return { route, names, pattern: new RegExp(`^${source}/?$`) }
  })
  return (method, pathname) => {
    for (const { route, names, pattern } of compiled) {
      if (route.method !== method) continue
      const found = pattern.exec(pathname)
      if (found === null) continue
      const params: Record<string, string> = {}
      names.forEach((name, index) => (params[name] = decodeURIComponent(found[index + 1] ?? '')))
      return { route, params }
    }
    return undefined
  }
}

/** JSON 응답입니다. */
export function json(body: unknown, status = 200, headers?: Headers): Response {
  const merged = new Headers(headers)
  merged.set('content-type', 'application/json')
  return new Response(JSON.stringify(body), { status, headers: merged })
}

/** 새 API 응답의 `ETag`를 현행 응답에 옮깁니다. 현행 클라이언트도 같은 `If-Match`를 씁니다. */
export function etagFrom(response: Response): Headers {
  const headers = new Headers()
  const etag = response.headers.get('etag')
  if (etag !== null) headers.set('etag', etag)
  return headers
}
