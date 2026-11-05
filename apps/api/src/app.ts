import { Effect, Layer } from 'effect'
import { HttpRouter, HttpServerError, HttpServerRespondable } from 'effect/http'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from './api.ts'
import { AssistantHttpLive, AssistantMemoryLive } from './modules/assistant/assistant.layer.ts'
import { BillingHttpLive, BillingMemoryLive } from './modules/billing/billing.layer.ts'
import { BookkeepingHttpLive, BookkeepingMemoryLive } from './modules/bookkeeping/bookkeeping.layer.ts'
import { DocumentsHttpLive, DocumentsMemoryLive } from './modules/documents/documents.layer.ts'
import { HrHttpLive, HrMemoryLive } from './modules/hr/hr.layer.ts'
import { AuthenticationLive } from './modules/identity-access/authentication.ts'
import { IdentityAccessHttpLive, IdentityAccessMemoryLive } from './modules/identity-access/identity-access.layer.ts'
import { IntegrationsHttpLive, IntegrationsMemoryLive } from './modules/integrations/integrations.layer.ts'
import { PayrollHttpLive, PayrollMemoryLive } from './modules/payroll/payroll.layer.ts'
import { TaxHttpLive, TaxMemoryLive } from './modules/tax/tax.layer.ts'
import { Internal, NotFound } from './shared/problem/problem.ts'
import { RequestValidationLive } from './shared/problem/request-validation.ts'

const SystemLive = HttpApiBuilder.group(Api, 'system', (handlers) =>
  handlers.handle('health', () => Effect.succeed({ status: 'ok' as const })),
)

/**
 * 일치하는 경로가 없거나 예상하지 못한 오류(defect)가 나면 Problem Details로 응답합니다.
 *
 * 엔드포인트에 선언한 오류는 여기까지 오지 않고, 해당 경로가 직접 응답으로 바꿉니다.
 */
const ProblemFallback = HttpRouter.middleware(
  (httpEffect) =>
    httpEffect.pipe(
      Effect.catchIf(isRouteNotFound, () => HttpServerRespondable.toResponse(new NotFound({}))),
      Effect.catchDefect(() => HttpServerRespondable.toResponse(new Internal({}))),
    ),
  { global: true },
)

function isRouteNotFound(error: unknown): boolean {
  return error instanceof HttpServerError.HttpServerError && error.reason._tag === 'RouteNotFound'
}

/** 모든 컨텍스트의 핸들러입니다. 컨텍스트의 저장소·외부 연동 포트와 `AccessTokens`는 호출하는 쪽이 넣습니다. */
const ContextsHttpLive = Layer.mergeAll(
  IdentityAccessHttpLive,
  BillingHttpLive,
  IntegrationsHttpLive,
  AssistantHttpLive,
  TaxHttpLive,
  HrHttpLive,
  DocumentsHttpLive,
  PayrollHttpLive,
  BookkeepingHttpLive,
)

/**
 * HTTP 서버에 올릴 수 있는 API 전체 경로입니다.
 *
 * 저장소와 외부 연동은 호출하는 쪽이 넣습니다. 로컬 개발과 테스트는 {@link MemoryLive}를 씁니다.
 */
export const AppLive = HttpApiBuilder.layer(Api).pipe(
  Layer.provide(SystemLive),
  Layer.provide(ContextsHttpLive),
  Layer.provide(AuthenticationLive),
  Layer.provide(RequestValidationLive),
  Layer.merge(ProblemFallback),
)

/**
 * 모든 컨텍스트의 저장소를 메모리 구현으로, 외부 연동을 결정적인 가짜로 채웁니다.
 *
 * `AccessTokens`는 여기에 넣지 않습니다. 테스트가 정한 토큰을 쓰도록 호출하는 쪽이 넣습니다.
 */
export const MemoryLive = Layer.mergeAll(
  IdentityAccessMemoryLive,
  BillingMemoryLive,
  IntegrationsMemoryLive,
  AssistantMemoryLive,
  TaxMemoryLive,
  HrMemoryLive,
  DocumentsMemoryLive,
  PayrollMemoryLive,
  BookkeepingMemoryLive,
)
