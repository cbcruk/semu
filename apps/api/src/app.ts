import { randomBytes } from 'node:crypto'
import { Effect, Layer } from 'effect'
import { HttpRouter, HttpServerError, HttpServerRespondable } from 'effect/http'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from './api.ts'
import { AssistantHttpLive, AssistantStoreLive } from './modules/assistant/assistant.layer.ts'
import { BillingHttpLive, BillingStoreLive, PaymentsLive } from './modules/billing/billing.layer.ts'
import { paymentScheduleTask } from './modules/billing/payments/payment-schedule-task.ts'
import { BookkeepingHttpLive, BookkeepingStoreLive } from './modules/bookkeeping/bookkeeping.layer.ts'
import { AccountNumberCipher } from './modules/bookkeeping/ports/account-number-cipher.ts'
import { DocumentsHttpLive, DocumentsStoreLive, EsignRequestsLive } from './modules/documents/documents.layer.ts'
import { esignExpiryTask } from './modules/documents/esign/esign-expiry-task.ts'
import { HrHttpLive, HrStoreLive } from './modules/hr/hr.layer.ts'
import { AgencyAuthenticationLive, AuthenticationLive } from './modules/identity-access/authentication.ts'
import { IdentityAccessHttpLive, IdentityAccessStoreLive } from './modules/identity-access/identity-access.layer.ts'
import { CredentialVault } from './modules/integrations/credentials/credential-vault.ts'
import {
  IntegrationsHttpLive,
  IntegrationsStoreLive,
  ScrapQueueInlineLive,
  ScrapRequestsLive,
} from './modules/integrations/integrations.layer.ts'
import { scheduledScrapTasks } from './modules/integrations/scrap-requests/scheduled-scrap-task.ts'
import { PayrollHttpLive, PayrollStoreLive } from './modules/payroll/payroll.layer.ts'
import { filingScheduleTask } from './modules/tax/calendar/filing-schedule-task.ts'
import { FilingSchedulerLive, TaxHttpLive, TaxStoreLive } from './modules/tax/tax.layer.ts'
import {
  OutboxRelayLive,
  PersistenceMemoryLive,
  PersistenceSqliteLive,
  UnitOfWorkMiddleware,
} from './shared/persistence/persistence.layer.ts'
import { DataKey } from './shared/crypto/data-key.ts'
import { FileStore } from './shared/files/file-store.ts'
import { PersonalDataAccessLog } from './shared/personal-data/personal-data-access-log.ts'
import { PersonalDataCipher } from './shared/personal-data/personal-data-cipher.ts'
import { describeDefect } from './shared/problem/defect-log.ts'
import { Internal, NotFound } from './shared/problem/problem.ts'
import { RequestValidationLive } from './shared/problem/request-validation.ts'
import { Scheduler, SchedulerRunnerLive } from './shared/scheduler/scheduler.ts'
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
 * 결함은 오류 이름과 코드 위치만 로그에 남깁니다({@link describeDefect}). 메시지에 저장 값이 섞일 수 있어서입니다.
 *
 * 엔드포인트에 선언한 오류는 여기까지 오지 않고, 해당 경로가 직접 응답으로 바꿉니다.
 */
const ProblemFallback = HttpRouter.middleware(
  (httpEffect) =>
    httpEffect.pipe(
      Effect.catchIf(isRouteNotFound, () => HttpServerRespondable.toResponse(new NotFound({}))),
      Effect.catchDefect((defect) =>
        Effect.logError('Unhandled defect', describeDefect(defect)).pipe(
          Effect.andThen(HttpServerRespondable.toResponse(new Internal({}))),
        ),
      ),
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
  Layer.provide(AgencyAuthenticationLive),
  Layer.provide(RequestValidationLive),
  Layer.merge(ProblemFallback),
  Layer.merge(UnitOfWorkMiddleware),
)

/**
 * 컨텍스트마다 자기가 소유한 저장소와 외부 기관 어댑터입니다. 공유 쉬는 날 참조데이터와 HR·Payroll이 함께 쓰는 개인정보 열람 기록도 넣습니다.
 *
 * 표는 모두 `TableFactory`로 만들어 저장 방식(메모리 또는 SQLite)을 바깥에서 받습니다.
 * 컨텍스트 사이 포트는 넣지 않습니다. 각 컨텍스트의 `<Ctx>MemoryLive`에 있는 그 포트의 가짜는 컨텍스트 단위 테스트에서만 씁니다.
 * 아직 제공하는 쪽이 없는 포트(Payroll `PayslipMailer`, Assistant `CompanyGrantProfiles`)는 그 컨텍스트의 가짜를 그대로 씁니다.
 */
const ContextStoresLive = Layer.mergeAll(
  IdentityAccessStoreLive,
  BillingStoreLive,
  IntegrationsStoreLive,
  AssistantStoreLive,
  TaxStoreLive,
  HrStoreLive,
  DocumentsStoreLive,
  PayrollStoreLive,
  BookkeepingStoreLive,
  PublicHolidayCalendar.layerMemory(),
  PersonalDataAccessLog.layer,
)

/**
 * 저장하는 개인정보·자격 증명의 실제 암호화입니다. 모두 AES-256-GCM이고, 키는 {@link DataKey}에서 용도마다 HKDF로 따로 만듭니다.
 *
 * - 공유 `PersonalDataCipher.layerAesGcm`: HR 직원·Payroll 소득자의 주민등록번호(외국인등록번호·여권번호)와 HR 급여 계좌번호 암호화,
 *   중복 판정용 HMAC-SHA256 해시
 * - Bookkeeping `AccountNumberCipher.layerAesGcm`: 회사·거래처·지로 출금 계좌번호
 * - Integrations `CredentialVault.layerDataKey`: 기관 연동 비밀번호·인증서 개인키와 서명 비밀번호
 */
export const CiphersLive = Layer.mergeAll(
  PersonalDataCipher.layerAesGcm,
  AccountNumberCipher.layerAesGcm,
  CredentialVault.layerDataKey,
)

/** 테스트용 가짜 암호화입니다. 결정적이고 고정 키라 저장하는 실행에는 쓰지 않습니다. */
const CiphersFakeLive = Layer.mergeAll(
  PersonalDataCipher.layerFake,
  AccountNumberCipher.layerFake,
  CredentialVault.layerMemory(),
)

type Ciphers = PersonalDataCipher | AccountNumberCipher | CredentialVault

/**
 * 저장소, 컨텍스트 사이 어댑터(`WiringLive`), 수집 큐를 공통 파일 저장소(`FileStore`, D7)와 `persistence`(표·트랜잭션·outbox), 암호화(`ciphers`) 위에 쌓습니다.
 *
 * 저장소는 컨텍스트마다 하나만 만들고, 핸들러와 어댑터가 같은 인스턴스를 씁니다. 한 컨텍스트에 쓴 값이 다른 컨텍스트에 바로 보입니다.
 * Integrations의 수집 큐는 Bookkeeping으로 가는 `ScrapedRecordSink`가 필요해 어댑터 위에 얹습니다.
 * `AccessTokens`는 넣지 않습니다. 테스트가 정한 토큰을 쓰도록 호출하는 쪽이 넣습니다.
 */
const storesOn = <E>(persistence: Layer.Layer<TableFactory | UnitOfWork | Outbox, E>, ciphers: Layer.Layer<Ciphers>) =>
  ScrapQueueInlineLive.pipe(
    Layer.provideMerge(WiringLive),
    Layer.provideMerge(ContextStoresLive),
    Layer.provideMerge(FileStore.layer),
    Layer.provideMerge(Layer.merge(persistence, ciphers)),
  )

/** {@link CiphersLive}에 `key`로 만든 {@link DataKey}를 넣습니다. */
const ciphersWithKey = (key: Uint8Array) => CiphersLive.pipe(Layer.provide(DataKey.layerFromKey(key)))

/**
 * 모든 저장소를 프로세스 메모리에 두고 가짜 암호화({@link CiphersFakeLive})를 씁니다. 트랜잭션이 없고 이벤트는 바로 소비자에게 갑니다.
 * 테스트와 로컬 개발용입니다.
 */
export const MemoryLive = storesOn(PersistenceMemoryLive, CiphersFakeLive)

/**
 * 정기 작업 목록입니다. 작업마다 이름·시각·재시도 규칙이 있고, 실행 기록은 `platform_scheduled_runs` 표에 남습니다(D11).
 *
 * | 작업 | 시각(회사 시간대) | 하는 일 |
 * |---|---|---|
 * | `documents.esign-expiry` | 매일 00:05 | 서명 기한이 지난 전자서명 요청 만료 |
 * | `tax.filing-schedule` | 매일 03:00 | 세무 기장 회사의 신고 건 만들기·기한 고치기·취소 |
 * | `billing.payment-schedule` | 매일 06:00 | 출금일 3일 전부터 전날까지 그달 월 이용료 결제 예정 만들기 |
 * | `integrations.scrap.<기관>-<HHMM>` | 기관마다(`SCHEDULED_SCRAP_TIMES`) | 연동이 있는 회사마다 정기(시스템) 수집 요청 |
 */
export const SCHEDULED_TASKS = [
  esignExpiryTask,
  filingScheduleTask,
  paymentScheduleTask,
  ...scheduledScrapTasks,
] as const

/** 정기 작업 실행기입니다. 시작할 때와 1분마다 지난 슬롯을 봅니다. 저장소·어댑터 위에 얹습니다. */
const SchedulerLive = SchedulerRunnerLive().pipe(
  Layer.provide(Scheduler.layer(SCHEDULED_TASKS)),
  Layer.provide(Layer.mergeAll(FilingSchedulerLive, PaymentsLive, EsignRequestsLive, ScrapRequestsLive)),
)

/** 서버가 정하는 실행 설정입니다. 테스트 앱은 정기 작업을 돌리지 않습니다. */
export interface RuntimeOptions {
  /** 정기 작업 실행기를 띄웁니다. 기본값은 끔입니다. */
  readonly scheduler?: boolean
}

const withScheduler = <A, E, R>(base: Layer.Layer<A, E, R>, options: RuntimeOptions) =>
  options.scheduler === true ? SchedulerLive.pipe(Layer.provideMerge(base)) : base

/** 모든 저장소를 프로세스 메모리에 두되 실제 암호화({@link CiphersLive})를 `key`로 씁니다. `SEMU_DATABASE=memory` 서버가 씁니다. */
export const EncryptedMemoryLive = (key: Uint8Array, options: RuntimeOptions = {}) =>
  withScheduler(storesOn(PersistenceMemoryLive, ciphersWithKey(key)), options)

/**
 * `filename`의 SQLite에 저장하고 실제 암호화({@link CiphersLive})를 데이터 키 `key`(32바이트)로 씁니다.
 * 요청마다 한 트랜잭션이고, 컨텍스트 사이 이벤트는 outbox를 거쳐 커밋 뒤에 전달됩니다. 시작할 때와 30초마다 밀린 이벤트를 다시 넘깁니다.
 * `options.scheduler`면 정기 작업({@link SCHEDULED_TASKS})도 돌립니다.
 *
 * 키를 잃거나 바꾸면 이미 저장한 암호문을 열 수 없습니다.
 */
export const SqliteLive = (filename: string, key: Uint8Array, options: RuntimeOptions = {}) =>
  withScheduler(
    OutboxRelayLive().pipe(Layer.provideMerge(storesOn(PersistenceSqliteLive(filename), ciphersWithKey(key)))),
    options,
  )

/**
 * 테스트 앱의 저장소입니다. 기본은 {@link MemoryLive}이고, `SEMU_TEST_STORE=sqlite`면 테스트 앱마다 새 메모리 SQLite({@link SqliteLive})입니다.
 * SQLite일 때는 프로세스마다 새로 뽑은 데이터 키로 실제 암호화를 씁니다. `pnpm test:sqlite`가 같은 테스트를 SQLite로 한 번 더 돌립니다.
 */
export const TestStoreLive =
  process.env['SEMU_TEST_STORE'] === 'sqlite' ? SqliteLive(':memory:', randomBytes(32)) : MemoryLive
