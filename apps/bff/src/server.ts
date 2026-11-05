import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { createBff } from './app.ts'

const port = Number(process.env['PORT'] ?? 3100)
/** 새 API 주소입니다. BFF는 이 주소의 `/v1`만 부릅니다. */
const apiUrl = (process.env['SEMU_API_URL'] ?? 'http://localhost:3000').replace(/\/$/, '')

const bff = createBff({ upstream: { baseUrl: apiUrl, fetch: (request) => fetch(request) } })

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
