import { Effect, Layer } from 'effect'
import { httpTestApp } from '../../shared/testing/http-test-app.ts'
import type { HttpTestRequest, HttpTestResponse } from '../../shared/testing/http-test-app.ts'
import { DEMO_PASSWORD } from './demo-seed.ts'
import { Mailer } from './notifications/mailer.ts'
import type { OutgoingMail } from './notifications/mailer.ts'

/** 테스트 요청 옵션입니다. */
export type TestRequest = HttpTestRequest

/** 테스트 응답입니다. 본문은 단언에서 바로 꺼내 쓰도록 느슨한 타입으로 읽습니다. */
export type TestResponse = HttpTestResponse

/** 메모리 저장소와 데모 시드로 띄운 앱입니다. 테스트 하나가 상태를 공유하며 여러 요청을 보냅니다. */
export interface TestApp {
  /** 앱의 웹 핸들러입니다. 테스트가 요청을 그대로 보낼 때 씁니다. */
  handler(request: Request): Promise<Response>
  request(method: string, path: string, options?: TestRequest): Promise<TestResponse>
  /** 데모 계정으로 로그인하고 access token과 refresh 쿠키를 돌려줍니다. */
  signIn(email: string, options?: { companyId?: string; password?: string }): Promise<SignedIn>
  /** 마지막으로 보낸 메일의 링크 토큰입니다. 초대·비밀번호 재설정 테스트에 씁니다. */
  lastMailToken(): Promise<string>
  dispose(): Promise<void>
}

/** 로그인 결과입니다. */
export interface SignedIn {
  token: string
  /** 다음 요청의 `Cookie` 헤더에 넣을 `semu_refresh=...` 값입니다. */
  cookie: string
  body: Record<string, unknown>
}

/**
 * 앱 전체를 메모리로 띄웁니다. 로그인부터 시작하는 HTTP 테스트에 씁니다. 토큰 표는 비어 있고, 경로는 `/v1`까지 씁니다.
 *
 * @example
 * ```ts
 * const app = makeTestApp()
 * const { token } = await app.signIn('owner@semu.example')
 * const response = await app.request('GET', '/v1/me', { token })
 * ```
 */
export function makeTestApp(): TestApp {
  const outbox: OutgoingMail[] = []
  const mailer = Layer.succeed(
    Mailer,
    Mailer.of({
      send: (mail) => Effect.sync(() => void outbox.push(mail)),
      sent: () => Effect.sync(() => [...outbox]),
    }),
  )
  const app = httpTestApp({ layers: [mailer] })
  const signIn = async (email: string, options: { companyId?: string; password?: string } = {}): Promise<SignedIn> => {
    const response = await app.request('POST', '/v1/auth/sessions', {
      body: {
        email,
        password: options.password ?? DEMO_PASSWORD,
        ...(options.companyId === undefined ? {} : { companyId: options.companyId }),
      },
    })
    if (response.status !== 200) throw new Error(`sign-in failed: ${response.status} ${await response.text()}`)
    const body = (await response.json()) as Record<string, unknown>
    return { token: String(body['accessToken']), cookie: cookieOf(response), body }
  }
  const lastMailToken = async (): Promise<string> => {
    const mail = outbox.at(-1)
    if (mail === undefined) throw new Error('no mail was sent')
    return mail.token
  }
  return { handler: app.handler, request: app.request, signIn, lastMailToken, dispose: app.dispose }
}

/** 응답의 `Set-Cookie`에서 다음 요청에 보낼 `name=value`만 꺼냅니다. */
export function cookieOf(response: Response): string {
  return (response.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
}
