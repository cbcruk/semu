import { appendClearedSessionCookies, CSRF_COOKIES, CSRF_HEADERS, parseCookies, SESSION_COOKIE } from './cookies.ts'
import { contractRoutes } from './hr/contracts.routes.ts'
import { hrRoutes } from './hr/hr.routes.ts'
import { leaveRoutes } from './hr/leaves.routes.ts'
import { retirementRoutes } from './hr/retirement.routes.ts'
import { identityRoutes } from './identity/identity.routes.ts'
import { IdempotencyKeys } from './idempotency.ts'
import { payrollLedgerRoutes } from './payroll/ledgers.routes.ts'
import { payslipRoutes } from './payroll/payslips.routes.ts'
import { LegacyError, legacyErrors } from './legacy-error.ts'
import { makeRouter } from './router.ts'
import type { Route } from './router.ts'
import { memorySessionStore, sameSecret, SessionLocks, sessionKey } from './sessions.ts'
import type { SessionStore } from './sessions.ts'
import type { BffDeps, UpstreamOptions } from './upstream.ts'

/** BFF가 받는 현행 경로 전체입니다. 화면을 새 API로 옮기면 그 화면의 경로를 여기서 지웁니다. */
export const ROUTES: readonly Route[] = [
  ...identityRoutes,
  ...hrRoutes,
  ...contractRoutes,
  ...leaveRoutes,
  ...retirementRoutes,
  ...payrollLedgerRoutes,
  ...payslipRoutes,
]

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** 만료된 세션을 쓸어 내는 간격입니다. 요청이 올 때 지난 간격이면 한 번 씁니다. */
const SWEEP_INTERVAL_MS = 60_000

/** 커서 목록을 끝까지 읽을 때의 기본 최대 쪽 수입니다. 200개씩이면 직원 10,000명입니다. */
const DEFAULT_MAX_UPSTREAM_PAGES = 50

/**
 * 현행 급여카드 목록이 행을 읽는 기본 최대 대장 수입니다. 대장마다 행 호출 하나라, 월 정기 대장과 추가 대장으로
 * 10년 넘게 쓴 회사(약 200개)까지 받고 그보다 많으면 연도로 거르게 합니다.
 */
export const DEFAULT_MAX_LEDGER_ROW_READS = 200

/**
 * 현행 명세서 발송이 같은 대상을 다시 보내면 처음 결과를 돌려주는 기본 시간(ms)입니다. 앞 발송이 끝난 때부터 셉니다.
 * 두 번 누르기와 업스트림 제한 시간(기본 10초) 뒤의 재시도를 덮고, 일부러 다시 보내는 사용자는 1분 뒤에 보낼 수 있습니다.
 */
export const DEFAULT_PAYSLIP_SEND_REPLAY_MS = 60_000

/** BFF 설정입니다. */
export interface BffOptions {
  upstream: UpstreamOptions
  /** 현행 클라이언트가 BFF를 부르는 공개 주소입니다. 예: `https://api.example.com`. DRF 링크를 이 주소로 만듭니다. */
  publicBaseUrl: string
  /**
   * 로그인을 받는 브라우저 출처(`Origin`)입니다. 비우면 `publicBaseUrl`의 출처 하나입니다.
   * 로그인에는 CSRF 토큰이 아직 없으므로, 다른 사이트가 피해자를 공격자 계정으로 로그인시키지 못하게 출처로 막습니다.
   */
  allowedOrigins?: readonly string[]
  store?: SessionStore
  now?: () => number
  maxUpstreamPages?: number
  /** 현행 급여카드 목록이 행을 읽는 최대 대장 수입니다. 기본 {@link DEFAULT_MAX_LEDGER_ROW_READS}입니다. */
  maxLedgerRowReads?: number
  /** 현행 명세서 발송의 재응답 시간(ms)입니다. 기본 {@link DEFAULT_PAYSLIP_SEND_REPLAY_MS}입니다. */
  payslipSendReplayMs?: number
}

/** 현행 와이어를 받는 BFF입니다. 웹 표준 `Request` → `Response` 핸들러 하나입니다. */
export interface Bff {
  handle(request: Request): Promise<Response>
  /** 세션 저장소입니다. 테스트가 세션 상태를 확인할 때 씁니다. */
  readonly store: SessionStore
}

/**
 * BFF를 만듭니다.
 *
 * 요청마다 현행 경로 표에서 라우트를 찾고, 로그인이 필요한 라우트는 `sessionid` 쿠키로 세션을 찾고
 * 쓰기 요청이면 CSRF 토큰(헤더 = 쿠키 = 세션)을 확인합니다. 라우트가 던진 {@link LegacyError}와 예상 밖 오류는
 * 현행 오류 본문 `{ detail, code }`로 응답합니다.
 *
 * @example
 * ```ts
 * const bff = createBff({ upstream: { baseUrl: 'http://localhost:3000', fetch }, publicBaseUrl: 'http://localhost:3100' })
 * const response = await bff.handle(new Request('http://localhost/api/user/me/'))
 * ```
 */
export function createBff(options: BffOptions): Bff {
  const now = options.now ?? Date.now
  const deps: BffDeps = {
    upstream: options.upstream,
    store: options.store ?? memorySessionStore(),
    locks: new SessionLocks(),
    now,
    publicBaseUrl: options.publicBaseUrl.replace(/\/$/, ''),
    allowedOrigins: new Set(
      options.allowedOrigins === undefined || options.allowedOrigins.length === 0
        ? [new URL(options.publicBaseUrl).origin]
        : options.allowedOrigins.map((origin) => new URL(origin).origin),
    ),
    maxUpstreamPages: options.maxUpstreamPages ?? DEFAULT_MAX_UPSTREAM_PAGES,
    maxLedgerRowReads: options.maxLedgerRowReads ?? DEFAULT_MAX_LEDGER_ROW_READS,
    idempotencyKeys: new IdempotencyKeys(options.payslipSendReplayMs ?? DEFAULT_PAYSLIP_SEND_REPLAY_MS, now),
  }
  const route = makeRouter(ROUTES)
  let lastSweep = deps.now()
  const sweepIfDue = async (): Promise<void> => {
    const now = deps.now()
    if (now - lastSweep < SWEEP_INTERVAL_MS) return
    lastSweep = now
    await deps.store.sweep(now)
  }

  const handle = async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    await sweepIfDue()
    const match = route(request.method, url.pathname)
    if (match === undefined) return legacyErrors.notFound().toResponse()
    try {
      if (!match.route.auth) return await match.route.handle({ request, url, params: match.params, deps })
      const sessionId = await authenticate(deps, request)
      return await match.route.handle({ request, url, params: match.params, deps, sessionId })
    } catch (error) {
      const failure = error instanceof LegacyError ? error : legacyErrors.internal()
      if (!(error instanceof LegacyError)) console.error(error)
      const headers = new Headers()
      if (failure.endsSession) appendClearedSessionCookies(headers)
      return failure.toResponse(headers)
    }
  }

  return { handle, store: deps.store }
}

/**
 * 현행 세션 쿠키로 BFF 세션을 찾습니다.
 *
 * @returns 세션 저장 키
 * @throws {LegacyError} 쿠키가 없거나 세션이 끝났으면 401 `UNAUTHENTICATED`, 쓰기 요청의 CSRF 토큰이 다르면 403 `CSRF_FAILED`
 */
async function authenticate(deps: BffDeps, request: Request): Promise<string> {
  const cookies = parseCookies(request.headers.get('cookie'))
  const token = cookies.get(SESSION_COOKIE)
  if (token === undefined || token === '') throw legacyErrors.unauthenticated()
  const id = sessionKey(token)
  const session = await deps.store.get(id)
  if (session === undefined) throw legacyErrors.unauthenticated({ endsSession: true })
  if (session.expiresAt <= deps.now()) {
    await deps.store.delete(id)
    throw legacyErrors.unauthenticated({ endsSession: true })
  }
  if (!SAFE_METHODS.has(request.method)) {
    const sent = CSRF_HEADERS.map((name) => request.headers.get(name)).find((value) => value !== null)
    if (sent === undefined || sent === null || !sameSecret(sent, session.csrfToken)) throw legacyErrors.csrfFailed()
    const echoed = CSRF_COOKIES.some((name) => sameSecret(cookies.get(name) ?? '', sent))
    if (!echoed) throw legacyErrors.csrfFailed()
  }
  return id
}
