import { Effect, Layer } from 'effect'
import { HttpRouter, HttpServerError, HttpServerRespondable } from 'effect/http'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from './api.ts'
import { AssistantHttpLive, AssistantMemoryLive } from './modules/assistant/assistant.layer.ts'
import { BillingHttpLive, BillingMemoryStoreLive } from './modules/billing/billing.layer.ts'
import { BookkeepingHttpLive, BookkeepingMemoryStoreLive } from './modules/bookkeeping/bookkeeping.layer.ts'
import { DocumentsHttpLive, DocumentsMemoryLive } from './modules/documents/documents.layer.ts'
import { HrHttpLive, HrMemoryStoreLive } from './modules/hr/hr.layer.ts'
import { AuthenticationLive } from './modules/identity-access/authentication.ts'
import { IdentityAccessHttpLive, IdentityAccessMemoryLive } from './modules/identity-access/identity-access.layer.ts'
import {
  IntegrationsHttpLive,
  IntegrationsMemoryStoreLive,
  ScrapQueueInlineLive,
} from './modules/integrations/integrations.layer.ts'
import { PayrollHttpLive, PayrollMemoryStoreLive } from './modules/payroll/payroll.layer.ts'
import { TaxHttpLive, TaxStoreLive } from './modules/tax/tax.layer.ts'
import {
  OutboxRelayLive,
  PersistenceMemoryLive,
  PersistenceSqliteLive,
  UnitOfWorkMiddleware,
} from './shared/persistence/persistence.layer.ts'
import { Internal, NotFound } from './shared/problem/problem.ts'
import { RequestValidationLive } from './shared/problem/request-validation.ts'
import { PublicHolidayCalendar } from './shared/time/public-holidays.ts'
import { WiringLive } from './wiring/wiring.layer.ts'
import type { Outbox } from './shared/persistence/outbox.ts'
import type { TableFactory } from './shared/persistence/record-table.ts'
import type { UnitOfWork } from './shared/persistence/unit-of-work.ts'

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

/**
 * 모든 컨텍스트의 핸들러입니다. 컨텍스트의 저장소·외부 연동 포트와 `AccessTokens`는 호출하는 쪽이 넣습니다.
 *
 * 컨텍스트 사이 포트(Documents의 `HrDirectory` 포함)는 {@link MemoryLive}처럼 `src/wiring/`의 `WiringLive`로 채웁니다.
 */
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
  Layer.merge(UnitOfWorkMiddleware),
)

/**
 * 컨텍스트마다 자기가 소유한 저장소와 외부 기관 어댑터입니다. 공유 쉬는 날 참조데이터도 넣습니다.
 *
 * `TableFactory`로 표를 만드는 컨텍스트(지금은 Tax)는 저장 방식을 바깥에서 받고, 아직 옮기지 않은 컨텍스트는 메모리 저장소입니다.
 * 컨텍스트 사이 포트는 넣지 않습니다. 각 컨텍스트의 `<Ctx>MemoryLive`에 있는 그 포트의 가짜는 컨텍스트 단위 테스트에서만 씁니다.
 * 아직 제공하는 쪽이 없는 포트(Payroll `PayslipMailer`, Assistant `CompanyGrantProfiles`)는 그 컨텍스트의 가짜를 그대로 씁니다.
 */
const ContextStoresLive = Layer.mergeAll(
  IdentityAccessMemoryLive,
  BillingMemoryStoreLive,
  IntegrationsMemoryStoreLive,
  AssistantMemoryLive,
  TaxStoreLive,
  HrMemoryStoreLive,
  DocumentsMemoryLive,
  PayrollMemoryStoreLive,
  BookkeepingMemoryStoreLive,
  PublicHolidayCalendar.layerMemory(),
)

/**
 * 저장소, 컨텍스트 사이 어댑터(`WiringLive`), 수집 큐를 `persistence`(표·트랜잭션·outbox) 위에 쌓습니다.
 *
 * 저장소는 컨텍스트마다 하나만 만들고, 핸들러와 어댑터가 같은 인스턴스를 씁니다. 한 컨텍스트에 쓴 값이 다른 컨텍스트에 바로 보입니다.
 * Integrations의 수집 큐는 Bookkeeping으로 가는 `ScrapedRecordSink`가 필요해 어댑터 위에 얹습니다.
 * `AccessTokens`는 넣지 않습니다. 테스트가 정한 토큰을 쓰도록 호출하는 쪽이 넣습니다.
 */
const storesOn = <E>(persistence: Layer.Layer<TableFactory | UnitOfWork | Outbox, E>) =>
  ScrapQueueInlineLive.pipe(
    Layer.provideMerge(WiringLive),
    Layer.provideMerge(ContextStoresLive),
    Layer.provideMerge(persistence),
  )

/** 모든 저장소를 프로세스 메모리에 둡니다. 트랜잭션이 없고 이벤트는 바로 소비자에게 갑니다. 테스트와 로컬 개발용입니다. */
export const MemoryLive = storesOn(PersistenceMemoryLive)

/**
 * `filename`의 SQLite에 저장합니다. 요청마다 한 트랜잭션이고, 컨텍스트 사이 이벤트는 outbox를 거쳐 커밋 뒤에 전달됩니다.
 * 시작할 때와 30초마다 밀린 이벤트를 다시 넘깁니다.
 */
export const SqliteLive = (filename: string) =>
  OutboxRelayLive().pipe(Layer.provideMerge(storesOn(PersistenceSqliteLive(filename))))

/**
 * 테스트 앱의 저장소입니다. 기본은 {@link MemoryLive}이고, `SEMU_TEST_STORE=sqlite`면 테스트 앱마다 새 메모리 SQLite({@link SqliteLive})입니다.
 * `pnpm test:sqlite`가 같은 테스트를 SQLite로 한 번 더 돌립니다.
 */
export const TestStoreLive = process.env['SEMU_TEST_STORE'] === 'sqlite' ? SqliteLive(':memory:') : MemoryLive
