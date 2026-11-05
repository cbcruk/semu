import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { createBff } from './app.ts'
import { positiveIntegerEnv } from './env.ts'
import { DEFAULT_AUTH_TIMEOUT_MS, DEFAULT_MAX_RESPONSE_BYTES, DEFAULT_UPSTREAM_TIMEOUT_MS } from './upstream.ts'

/** 숫자 환경 변수입니다. 비었으면 기본값이고, 숫자가 아니거나 0 이하이면 이유를 남기고 시작하지 않습니다. */
function numericEnv(name: string, fallback: number): number {
  try {
    return positiveIntegerEnv(process.env, name, fallback)
  } catch (error) {
    console.error(`Refusing to start: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

const port = numericEnv('PORT', 3100)
/** 새 API 주소입니다. BFF는 이 주소의 `/v1`만 부릅니다. */
const apiUrl = (process.env['SEMU_API_URL'] ?? 'http://localhost:3000').replace(/\/$/, '')

/** 현행 클라이언트가 BFF를 부르는 공개 주소입니다. DRF `next`·`previous` 링크를 이 주소로 만듭니다. */
const publicBaseUrl = process.env['BFF_PUBLIC_URL'] ?? `http://localhost:${port}`
/** 로그인을 받는 브라우저 출처입니다. 쉼표로 여럿. 비우면 `BFF_PUBLIC_URL`의 출처입니다. */
const allowedOrigins = (process.env['BFF_ALLOWED_ORIGINS'] ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin !== '')
/** 새 API 요청 하나의 제한 시간(ms)입니다. */
const timeoutMs = numericEnv('BFF_UPSTREAM_TIMEOUT_MS', DEFAULT_UPSTREAM_TIMEOUT_MS)
/** 로그인·갱신·회사 전환의 제한 시간(ms)입니다. refresh 쿠키 회전을 놓치지 않게 길게 둡니다. */
const authTimeoutMs = numericEnv('BFF_AUTH_TIMEOUT_MS', DEFAULT_AUTH_TIMEOUT_MS)

/** 새 API 응답 본문 하나의 최대 크기(바이트)입니다. 넘으면 502 `UPSTREAM_RESPONSE_TOO_LARGE`입니다. */
const maxResponseBytes = numericEnv('BFF_UPSTREAM_MAX_RESPONSE_BYTES', DEFAULT_MAX_RESPONSE_BYTES)

const bff = createBff({
  upstream: { baseUrl: apiUrl, fetch: (request) => fetch(request), timeoutMs, authTimeoutMs, maxResponseBytes },
  publicBaseUrl,
  allowedOrigins,
})

/** Node 요청을 웹 표준 `Request`로 바꿉니다. */
function toRequest(incoming: IncomingMessage): Request {
  const headers = new Headers()
  for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
    headers.append(incoming.rawHeaders[index] ?? '', incoming.rawHeaders[index + 1] ?? '')
  }
  const method = incoming.method ?? 'GET'
  const init: RequestInit & { duplex?: 'half' } = { method, headers }
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = Readable.toWeb(incoming) as ReadableStream
    init.duplex = 'half'
  }
  return new Request(`http://${incoming.headers.host ?? 'localhost'}${incoming.url ?? '/'}`, init)
}

/** 웹 표준 `Response`를 Node 응답으로 씁니다. `Set-Cookie`는 여러 줄을 그대로 둡니다. */
async function write(response: Response, outgoing: ServerResponse): Promise<void> {
  response.headers.forEach((value, name) => {
    if (name !== 'set-cookie') outgoing.setHeader(name, value)
  })
  const cookies = response.headers.getSetCookie()
  if (cookies.length > 0) outgoing.setHeader('set-cookie', cookies)
  outgoing.writeHead(response.status)
  outgoing.end(Buffer.from(await response.arrayBuffer()))
}

createServer((incoming, outgoing) => {
  bff
    .handle(toRequest(incoming))
    .then((response) => write(response, outgoing))
    .catch((error: unknown) => {
      console.error(error)
      outgoing.writeHead(500, { 'content-type': 'application/json' })
      outgoing.end(JSON.stringify({ detail: 'Internal server error.', code: 'INTERNAL_ERROR' }))
    })
}).listen(port, () => console.log(`bff listening on http://localhost:${port} → ${apiUrl}/v1`))
