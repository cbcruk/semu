import { cookiePair } from './cookies.ts'
import type { IdempotencyKeys } from './idempotency.ts'
import { fromProblem, LegacyError, legacyErrors } from './legacy-error.ts'
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
  /** 요청 하나(헤더와 본문까지)를 기다리는 최대 시간(ms)입니다. 넘으면 현행 504로 응답합니다. 기본 10초입니다. */
  timeoutMs?: number
  /**
   * 로그인·갱신·회사 전환의 제한 시간(ms)입니다. 기본 30초로 일반 호출보다 깁니다.
   * 이 호출이 시간 초과로 끝났는데 새 API가 그 뒤에 refresh 쿠키를 회전시키면, BFF는 새 쿠키를 받지 못해 다음 갱신에서
   * 재사용 탐지에 걸려 세션을 잃습니다. 여유를 길게 두어 그 창을 줄입니다.
   */
  authTimeoutMs?: number
  /**
   * 외부 효과를 요청 안에서 끝내는 발송(명세서 `:send`)의 제한 시간(ms)입니다. 기본 2분으로 일반 호출보다 깁니다.
   * 새 API는 명세서마다 차례로 메일을 보냅니다. BFF가 먼저 시간 초과로 끝내면 새 API는 발송을 끝까지 하지만, 그사이 사용자의
   * 재시도는 409 `IDEMPOTENCY_KEY_IN_PROGRESS`를 받아 결과를 모릅니다. 실제 메일 연동에서 그런 일이 드물게 길게 둡니다.
   */
  sendTimeoutMs?: number
  /**
   * 응답 본문 하나의 최대 크기(바이트)입니다. 기본 10MB입니다. `send`는 본문을 메모리에 다 읽으므로,
   * 넘으면 읽기를 멈추고 요청을 취소한 뒤 502 `UPSTREAM_RESPONSE_TOO_LARGE`로 응답합니다.
   */
  maxResponseBytes?: number
}

/** 기본 업스트림 제한 시간입니다. */
export const DEFAULT_UPSTREAM_TIMEOUT_MS = 10_000

/** 기본 인증 호출 제한 시간입니다. */
export const DEFAULT_AUTH_TIMEOUT_MS = 30_000

/** 기본 발송 호출 제한 시간입니다. 2분입니다. */
export const DEFAULT_SEND_TIMEOUT_MS = 120_000

/** 기본 업스트림 응답 본문 최대 크기(바이트)입니다. 10MB입니다. */
export const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024

/** BFF 라우트가 공유하는 의존성입니다. */
export interface BffDeps {
  upstream: UpstreamOptions
  store: SessionStore
  locks: SessionLocks
  /** 현재 시각(ms)입니다. 테스트가 토큰 만료를 흉내 낼 때 바꿉니다. */
  now: () => number
  /** 현행 응답의 절대 링크(`next`, `previous`)를 만드는 공개 주소입니다. `Host` 헤더를 믿지 않습니다. 끝 슬래시 없이 씁니다. */
  publicBaseUrl: string
  /** 커서 목록을 끝까지 읽을 때 따라가는 최대 쪽 수입니다. */
  maxUpstreamPages: number
  /** 현행 급여카드 목록 한 번에 행을 읽는 최대 대장 수입니다. 넘으면 행 호출 전에 502입니다. */
  maxLedgerRowReads: number
  /** 로그인을 받는 브라우저 출처입니다. */
  allowedOrigins: ReadonlySet<string>
  /** 현행 명세서 발송에 붙이는 `Idempotency-Key`입니다. 두 번 누르기·재시도가 두 번 보내지 않게 합니다. */
  idempotencyKeys: IdempotencyKeys
}

/** access token 만료 몇 초 전에 미리 갱신할지입니다. 요청이 오가는 사이에 만료되지 않게 합니다. */
const ACCESS_EXPIRY_SKEW_MS = 30_000

interface UpstreamRequest {
  /** 로그인·갱신·전환처럼 refresh 쿠키를 회전시키는 호출입니다. {@link UpstreamOptions.authTimeoutMs}를 씁니다. */
  auth?: boolean
  /** 외부 효과를 요청 안에서 끝내는 발송 호출입니다. {@link UpstreamOptions.sendTimeoutMs}를 씁니다. */
  send?: boolean
  token?: string | undefined
  cookie?: string | undefined
  body?: unknown
  headers?: Record<string, string>
}

/**
 * 새 API에 요청 하나를 보내고 본문까지 다 읽은 응답을 돌려줍니다.
 *
 * 제한 시간은 헤더뿐 아니라 본문을 다 읽을 때까지입니다. 지나면 요청을 취소(`AbortSignal`)하고 현행 504 `GATEWAY_TIMEOUT`을
 * 던집니다. 업스트림이 신호를 무시해도 기다림은 끝나므로, 이 호출을 감싼 세션 자물쇠도 풀립니다. 연결 실패는 502 `BAD_GATEWAY`입니다.
 * 돌려준 응답의 본문은 메모리에 있으므로 호출한 쪽이 읽다가 멈추지 않습니다.
 * 본문이 {@link UpstreamOptions.maxResponseBytes}(기본 10MB)를 넘으면 더 읽지 않고 요청을 취소한 뒤 502 `UPSTREAM_RESPONSE_TOO_LARGE`입니다.
 */
export async function send(
  deps: BffDeps,
  method: string,
  path: string,
  options: UpstreamRequest = {},
): Promise<Response> {
  const headers = new Headers(options.headers)
  if (options.token !== undefined) headers.set('authorization', `Bearer ${options.token}`)
  if (options.cookie !== undefined) headers.set('cookie', options.cookie)
  const controller = new AbortController()
  const init: RequestInit = { method, headers, signal: controller.signal }
  if (options.body !== undefined) {
    headers.set('content-type', 'application/json')
    init.body = JSON.stringify(options.body)
  }
  const timeoutMs =
    options.auth === true
      ? (deps.upstream.authTimeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS)
      : options.send === true
        ? (deps.upstream.sendTimeoutMs ?? DEFAULT_SEND_TIMEOUT_MS)
        : (deps.upstream.timeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS)
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(upstreamTimeout())
    }, timeoutMs)
  })
  const exchange = async (): Promise<Response> => {
    const response = await deps.upstream.fetch(new Request(`${deps.upstream.baseUrl}${path}`, init))
    const body = await readCapped(response, deps.upstream.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES, controller)
    return new Response(response.status === 204 || response.status === 304 ? null : body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }
  try {
    return await Promise.race([exchange(), timedOut])
  } catch (error) {
    if (error instanceof LegacyError) throw error
    if (controller.signal.aborted) throw upstreamTimeout()
    console.error(error)
    throw new LegacyError(502, { detail: 'The upstream API is unavailable.', code: 'BAD_GATEWAY' })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 본문을 `maxBytes`까지만 읽습니다. `Content-Length`가 이미 크거나 읽는 중에 넘으면 요청을 취소하고 502를 던집니다.
 * `Content-Length`를 믿지 않고 읽은 바이트도 셉니다.
 */
async function readCapped(response: Response, maxBytes: number, controller: AbortController): Promise<Uint8Array> {
  const tooLarge = (cancel: () => Promise<void>) => {
    controller.abort()
    void cancel().catch(() => {})
    return new LegacyError(502, {
      detail: 'The upstream API response is too large.',
      code: 'UPSTREAM_RESPONSE_TOO_LARGE',
    })
  }
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (declared > maxBytes) throw tooLarge(async () => response.body?.cancel())
  if (response.body === null) return new Uint8Array(0)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) throw tooLarge(() => reader.cancel())
    chunks.push(value)
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

function upstreamTimeout(): LegacyError {
  return new LegacyError(504, { detail: 'The upstream API did not respond in time.', code: 'GATEWAY_TIMEOUT' })
}

/** 성공 응답의 본문을 읽고, 실패면 현행 오류로 바꿔 던집니다. */
export async function readJson<A>(response: Response): Promise<A> {
  const body: unknown = await response.json().catch(() => undefined)
  if (!response.ok) throw fromProblem(response.status, body)
  return body as A
}

/** 로그인·갱신·전환 응답으로 BFF 세션을 고칩니다. */
export function applyGrant(
  session: Omit<BffSession, 'accessToken' | 'accessExpiresAt' | 'companyId' | 'actorKind'>,
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
  if (grant.company !== undefined) {
    next.companyId = grant.company.id
    next.actorKind = grant.company.actorKind
  }
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
  const response = await send(deps, 'POST', '/v1/auth/sessions', { body: input, auth: true })
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

/**
 * 새 API 세션을 끝내고 BFF 세션을 지웁니다. 새 API가 이미 끝낸 세션이거나 응답하지 않아도 BFF 세션은 지웁니다.
 * 새 API 세션은 refresh 쿠키 수명이 지나면 스스로 끝납니다.
 */
export async function signOut(deps: BffDeps, session: BffSession): Promise<void> {
  await deps.locks.exclusive(session.id, async () => {
    try {
      await send(deps, 'DELETE', '/v1/auth/sessions/current', { cookie: session.refreshCookie })
    } catch (error) {
      if (!(error instanceof LegacyError)) throw error
    } finally {
      await deps.store.delete(session.id)
    }
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
          auth: true,
        })
      : await send(deps, 'POST', '/v1/auth/sessions:refresh', { cookie: session.refreshCookie, auth: true })
    if (response.status === 401) {
      await deps.store.delete(sessionId)
      throw legacyErrors.unauthenticated({ endsSession: true })
    }
    // 새 ID 형식이 아니면 새 API는 400, 접근할 수 없으면 404입니다. 현행은 둘 다 404 "Company not found."였습니다.
    if (switching && (response.status === 400 || response.status === 404)) throw legacyErrors.notFound('Company')
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
 * 호출을 보내기 직전에, 그 호출에 쓸 access token을 받은 세션으로 확인합니다. 거절이면 던질 오류를 돌려줍니다.
 *
 * 세션의 `actorKind`처럼 grant에서 온 값은 그 토큰과 함께 바뀌므로, 호출과 같은 자물쇠 안에서 보면 늘 실제로 보내는 토큰의 값입니다.
 */
export type SessionGuard = (session: BffSession) => LegacyError | undefined

/** {@link callApi}의 옵션입니다. */
export type CallOptions = Omit<UpstreamRequest, 'token' | 'cookie'> & {
  /**
   * 보내기 전에 부르는 확인입니다. 401로 갱신해 다시 보낼 때도 다시 부릅니다.
   *
   * 세션은 새 API가 토큰을 폐기한 것을 401을 받기 전까지 모르므로, 저장된 값이 오래됐을 수 있습니다. 그래서 이 호출에서
   * 아직 갱신·전환하지 않았는데 거절이면 한 번 갱신해 새 grant로 다시 확인하고, 그래도 거절이면 그 오류를 던집니다.
   * 거절된 요청은 새 API에 닿지 않습니다.
   */
  guard?: SessionGuard
}

/**
 * 세션의 권한으로 새 API를 부릅니다. 경로의 회사로 먼저 전환하고, access token이 거절되면 갱신해 다시 보냅니다.
 *
 * 호출은 세션의 공유 자물쇠 안에서 보내므로, 같은 세션의 다른 요청이 호출 도중 회사를 바꾸지 못합니다.
 *
 * @param companyId 현행 경로의 회사 ID입니다. 회사와 상관없는 호출은 비웁니다.
 * @throws {LegacyError} `guard`가 갱신 뒤에도 거절하면 그 오류
 */
export async function callApi(
  deps: BffDeps,
  sessionId: string,
  companyId: string | undefined,
  method: string,
  path: string,
  options: CallOptions = {},
): Promise<Response> {
  const { guard, ...request } = options
  let renewed = false
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const outcome = await deps.locks.shared(sessionId, async () => {
      const session = await deps.store.get(sessionId)
      if (session === undefined) throw legacyErrors.unauthenticated({ endsSession: true })
      if (!usable(session, companyId, deps.now())) return { renew: true, stale: undefined } as const
      const refused = guard?.(session)
      if (refused !== undefined) {
        if (renewed) throw refused
        return { renew: true, stale: session.accessToken } as const
      }
      const response = await send(deps, method, path, { ...request, token: session.accessToken })
      if (response.status !== 401) return { renew: false, response } as const
      return { renew: true, stale: session.accessToken } as const
    })
    if (!outcome.renew) return outcome.response
    await ensureAccess(deps, sessionId, companyId, outcome.stale)
    renewed = true
  }
  throw legacyErrors.unauthenticated()
}
