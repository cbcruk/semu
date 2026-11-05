import { cookiePair } from './cookies.ts'
import { fromProblem, legacyErrors } from './legacy-error.ts'
import { randomToken, SessionLocks, sessionKey, sessionLifetimeMs } from './sessions.ts'
import type { BffSession, SessionStore } from './sessions.ts'
import type { SessionGrant } from './upstream.types.ts'

/**
 * 새 API를 부르는 방법입니다. 운영은 `fetch`로 HTTP를 쓰고, 테스트와 한 프로세스 배포는 API의 웹 핸들러를 넣습니다.
 * 어느 쪽이든 BFF가 보는 것은 `/v1` 와이어 계약뿐입니다.
 */
export interface UpstreamOptions {
  /** 예: `http://localhost:3000`. 끝 슬래시 없이 씁니다. */
  baseUrl: string
  fetch: (request: Request) => Promise<Response>
}

/** BFF 라우트가 공유하는 의존성입니다. */
export interface BffDeps {
  upstream: UpstreamOptions
  store: SessionStore
  locks: SessionLocks
  /** 현재 시각(ms)입니다. 테스트가 토큰 만료를 흉내 낼 때 바꿉니다. */
  now: () => number
}

/** access token 만료 몇 초 전에 미리 갱신할지입니다. 요청이 오가는 사이에 만료되지 않게 합니다. */
const ACCESS_EXPIRY_SKEW_MS = 30_000

interface UpstreamRequest {
  token?: string | undefined
  cookie?: string | undefined
  body?: unknown
  headers?: Record<string, string>
}

/** 새 API에 요청 하나를 보냅니다. */
export function send(deps: BffDeps, method: string, path: string, options: UpstreamRequest = {}): Promise<Response> {
  const headers = new Headers(options.headers)
  if (options.token !== undefined) headers.set('authorization', `Bearer ${options.token}`)
  if (options.cookie !== undefined) headers.set('cookie', options.cookie)
  const init: RequestInit = { method, headers }
  if (options.body !== undefined) {
    headers.set('content-type', 'application/json')
    init.body = JSON.stringify(options.body)
  }
  return deps.upstream.fetch(new Request(`${deps.upstream.baseUrl}${path}`, init))
}

/** 성공 응답의 본문을 읽고, 실패면 현행 오류로 바꿔 던집니다. */
export async function readJson<A>(response: Response): Promise<A> {
  const body: unknown = await response.json().catch(() => undefined)
  if (!response.ok) throw fromProblem(response.status, body)
  return body as A
}

/** 로그인·갱신·전환 응답으로 BFF 세션을 고칩니다. */
export function applyGrant(
  session: Omit<BffSession, 'accessToken' | 'accessExpiresAt' | 'companyId'>,
  grant: SessionGrant,
  refreshCookie: string | undefined,
  now: number,
): BffSession {
  const next: BffSession = {
    id: session.id,
    csrfToken: session.csrfToken,
    refreshCookie: refreshCookie ?? session.refreshCookie,
    plans: grant.company?.plans ?? [],
    user: grant.user,
    staySignedIn: session.staySignedIn,
    expiresAt: session.expiresAt,
  }
  if (grant.accessToken !== undefined) {
    next.accessToken = grant.accessToken
    next.accessExpiresAt = now + (grant.expiresIn ?? 600) * 1000 - ACCESS_EXPIRY_SKEW_MS
  }
  if (grant.company !== undefined) next.companyId = grant.company.id
  return next
}

/**
 * 새 API에 로그인하고 BFF 세션을 만듭니다. 쿠키에 넣을 토큰과 세션을 돌려줍니다.
 *
 * @throws {LegacyError} 새 API가 거절하면 그 문제를 현행 오류로 바꾼 것
 */
export async function signIn(
  deps: BffDeps,
  input: { email?: unknown; password?: unknown; staySignedIn?: unknown; companyId?: unknown },
): Promise<{ token: string; session: BffSession }> {
  const response = await send(deps, 'POST', '/v1/auth/sessions', { body: input })
  const grant = await readJson<SessionGrant>(response)
  const token = randomToken()
  const now = deps.now()
  const staySignedIn = input.staySignedIn === true
  const session = applyGrant(
    {
      id: sessionKey(token),
      csrfToken: randomToken(),
      refreshCookie: '',
      plans: [],
      user: grant.user,
      staySignedIn,
      expiresAt: now + sessionLifetimeMs(staySignedIn),
    },
    grant,
    cookiePair(response.headers.get('set-cookie')),
    now,
  )
  await deps.store.save(session)
  return { token, session }
}

/** 새 API 세션을 끝내고 BFF 세션을 지웁니다. 새 API가 이미 끝낸 세션이어도 성공으로 봅니다. */
export async function signOut(deps: BffDeps, session: BffSession): Promise<void> {
  await deps.locks.exclusive(session.id, async () => {
    await send(deps, 'DELETE', '/v1/auth/sessions/current', { cookie: session.refreshCookie })
    await deps.store.delete(session.id)
  })
}

/**
 * 세션의 access token이 `companyId` 회사에 묶이고 만료 전이 되게 합니다.
 *
 * 다른 회사면 `:switch-company`, 만료가 가까우면 `:refresh`를 부릅니다. 둘 다 refresh 쿠키를 회전시키므로
 * 세션 자물쇠 안에서 저장소의 최신 세션을 다시 읽고 고칩니다.
 *
 * @param staleToken 새 API가 401로 거절한 토큰입니다. 세션이 아직 이 토큰을 들고 있으면 만료와 상관없이 갱신합니다.
 * @throws {LegacyError} 세션이 끝났으면 `UNAUTHENTICATED`(쿠키 삭제), 회사에 접근할 수 없으면 `NOT_FOUND`
 */
export function ensureAccess(
  deps: BffDeps,
  sessionId: string,
  companyId: string | undefined,
  staleToken?: string,
): Promise<BffSession> {
  return deps.locks.exclusive(sessionId, async () => {
    const session = await deps.store.get(sessionId)
    if (session === undefined) throw legacyErrors.unauthenticated({ endsSession: true })
    const switching = companyId !== undefined && companyId !== session.companyId
    const expired =
      session.accessToken === undefined ||
      session.accessToken === staleToken ||
      (session.accessExpiresAt ?? 0) <= deps.now()
    if (!switching && !expired) return session
    // 회사가 없는 사용자(onboarding)는 갱신해도 access token이 생기지 않습니다.
    if (!switching && session.companyId === undefined) return session
    const response = switching
      ? await send(deps, 'POST', '/v1/auth/sessions:switch-company', {
          cookie: session.refreshCookie,
          body: { companyId },
        })
      : await send(deps, 'POST', '/v1/auth/sessions:refresh', { cookie: session.refreshCookie })
    if (response.status === 401) {
      await deps.store.delete(sessionId)
      throw legacyErrors.unauthenticated({ endsSession: true })
    }
    const grant = await readJson<SessionGrant>(response)
    const next = applyGrant(session, grant, cookiePair(response.headers.get('set-cookie')), deps.now())
    await deps.store.save(next)
    return next
  })
}

/** 세션의 access token을 그대로 `companyId` 호출에 쓸 수 있는지입니다. */
function usable(session: BffSession, companyId: string | undefined, now: number): boolean {
  return (
    session.accessToken !== undefined &&
    (companyId === undefined || companyId === session.companyId) &&
    (session.accessExpiresAt ?? 0) > now
  )
}

/** 갱신·전환 뒤 다시 시도하는 횟수입니다. 다른 요청이 그사이 회사를 또 바꾸면 한 번 더 기다립니다. */
const MAX_ATTEMPTS = 3

/**
 * 세션의 권한으로 새 API를 부릅니다. 경로의 회사로 먼저 전환하고, access token이 거절되면 갱신해 다시 보냅니다.
 *
 * 호출은 세션의 공유 자물쇠 안에서 보내므로, 같은 세션의 다른 요청이 호출 도중 회사를 바꾸지 못합니다.
 *
 * @param companyId 현행 경로의 회사 ID입니다. 회사와 상관없는 호출은 비웁니다.
 */
export async function callApi(
  deps: BffDeps,
  sessionId: string,
  companyId: string | undefined,
  method: string,
  path: string,
  options: Omit<UpstreamRequest, 'token' | 'cookie'> = {},
): Promise<Response> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const outcome = await deps.locks.shared(sessionId, async () => {
      const session = await deps.store.get(sessionId)
      if (session === undefined) throw legacyErrors.unauthenticated({ endsSession: true })
      if (!usable(session, companyId, deps.now())) return { renew: true, stale: undefined } as const
      const response = await send(deps, method, path, { ...options, token: session.accessToken })
      if (response.status !== 401) return { renew: false, response } as const
      return { renew: true, stale: session.accessToken } as const
    })
    if (!outcome.renew) return outcome.response
    await ensureAccess(deps, sessionId, companyId, outcome.stale)
  }
  throw legacyErrors.unauthenticated()
}
