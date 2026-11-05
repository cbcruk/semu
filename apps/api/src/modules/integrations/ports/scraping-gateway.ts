import { Context, Effect, Layer } from 'effect'
import type { AuthMethod, InstitutionType } from '../institutions/institution.ts'
import type { ScrapedRecord } from './scraped-record-sink.ts'

/** 수집 워커 경계 안에서만 쓰는 자격 증명 원문입니다. */
export interface GatewayCredential {
  authMethod: AuthMethod
  accountId?: string
  password?: string
  /** PG 연동키입니다. */
  keys?: Readonly<Record<string, string>>
  /** 인증서 연동이면 로컬 프로그램이 올린 인증서 묶음과 서명 비밀번호입니다. */
  certificate?: { bundle: string; signPassword: string }
}

/** 기관 로그인 요청입니다. */
export interface GatewayLogin {
  type: InstitutionType
  institutionCodes: ReadonlyArray<string>
  isCorporate: boolean
  businessNumber: string
  credential: GatewayCredential
}

/** 기관이 자격 증명을 받았는지입니다. 거절 코드는 어댑터가 기관 오류를 분류해 정합니다. */
export type GatewayCheck = { ok: true } | { ok: false; code: string; isRetryable: boolean }

/** 기관이 알려 준 카드·계좌·매장입니다. */
export interface GatewayCandidate {
  institutionCode: string
  /** 기관 쪽 식별자입니다. 연동 항목의 `key`가 됩니다. */
  key: string
  name: string
  /** 카드·계좌 번호 원문입니다. 매장은 없습니다. */
  number?: string
}

/** 수집 작업 하나입니다. */
export interface GatewayScrapJob {
  companyId: string
  businessNumber: string
  type: InstitutionType
  institutionCode?: string
  /** 수집할 항목입니다. 비어 있으면 연동 전체입니다. */
  itemKeys: ReadonlyArray<string>
  credential: GatewayCredential
  isInitial: boolean
  options: Readonly<Record<string, unknown>>
}

/** 항목 하나의 수집 결과입니다. */
export type GatewayScrapOutcome =
  | { itemKey?: string; status: 'SUCCEEDED'; records: ScrapedRecord[] }
  | { itemKey?: string; status: 'FAILED'; code: string; isRetryable: boolean }

/** 인터넷지로 간편가입 요청입니다. 지로 ID·비밀번호는 어댑터로만 넘기고 저장하지 않습니다. */
export interface GiroSignup {
  certificate: { bundle: string; signPassword: string }
  giroLoginId: string
  giroPassword: string
  email: string
  phone: string
}

/**
 * 홈택스·카드사·은행·PG·배달앱·인터넷지로와 이야기하는 수집 업체 어댑터 포트입니다.
 *
 * 후보 조회와 자격 증명 확인은 동기 호출이고, 수집은 수집 요청(`Job`)을 처리하는 워커만 부릅니다.
 */
export class ScrapingGateway extends Context.Service<
  ScrapingGateway,
  {
    verifyCredential(login: GatewayLogin): Effect.Effect<GatewayCheck>
    listCandidates(login: GatewayLogin): Effect.Effect<{ check: GatewayCheck; candidates: GatewayCandidate[] }>
    scrape(job: GatewayScrapJob): Effect.Effect<GatewayScrapOutcome[]>
    checkCertificatePassword(certificate: { bundle: string; signPassword: string }): Effect.Effect<boolean>
    joinGiro(signup: GiroSignup): Effect.Effect<GatewayCheck>
  }
>()('semu/integrations/ScrapingGateway') {
  /**
   * 결정적인 가짜입니다. `wrong`으로 시작하는 비밀번호는 거절하고, 키에 `fail`이 든 항목은 수집에 실패합니다.
   *
   * 후보는 기관 코드마다 셋(`<코드>-1`…`<코드>-3`)이고, 성공한 수집은 항목마다 기록 둘을 돌려줍니다.
   */
  static readonly layerFake = Layer.succeed(
    ScrapingGateway,
    ScrapingGateway.of({
      verifyCredential: (login) => Effect.succeed(fakeCheck(login.credential)),
      listCandidates: (login) =>
        Effect.succeed({
          check: fakeCheck(login.credential),
          candidates: login.institutionCodes.flatMap((code) =>
            [1, 2, 3].map((index) => fakeCandidate(login.type, code, index)),
          ),
        }),
      scrape: (job) =>
        Effect.succeed(
          (job.itemKeys.length === 0 ? [undefined] : job.itemKeys).map((itemKey) => fakeScrape(job, itemKey)),
        ),
      checkCertificatePassword: (certificate) => Effect.succeed(!certificate.signPassword.startsWith(WRONG)),
      joinGiro: (signup) =>
        Effect.succeed(
          signup.giroPassword.startsWith(WRONG)
            ? { ok: false, code: 'GIRO_JOIN_REJECTED', isRetryable: false }
            : { ok: true },
        ),
    }),
  )
}

const WRONG = 'wrong'

function fakeCheck(credential: GatewayCredential): GatewayCheck {
  const secrets = [credential.password, credential.certificate?.signPassword, ...Object.values(credential.keys ?? {})]
  return secrets.some((secret) => secret?.startsWith(WRONG) === true)
    ? { ok: false, code: 'INVALID_CREDENTIAL', isRetryable: false }
    : { ok: true }
}

function fakeCandidate(type: InstitutionType, code: string, index: number): GatewayCandidate {
  if (type === 'DELIVERY') return { institutionCode: code, key: `${code}-${index}`, name: `매장 ${index}` }
  const name = type === 'BANK' ? `입출금 ${index}` : `법인카드 ${index}`
  return { institutionCode: code, key: `${code}-${index}`, name, number: `94100000000${index}${index}${index}${index}` }
}

function fakeScrape(job: GatewayScrapJob, itemKey: string | undefined): GatewayScrapOutcome {
  const key = itemKey ?? job.institutionCode ?? job.type
  if (key.includes('fail')) {
    return {
      ...(itemKey === undefined ? {} : { itemKey }),
      status: 'FAILED',
      code: 'INSTITUTION_UNAVAILABLE',
      isRetryable: true,
    }
  }
  const records: ScrapedRecord[] = [1, 2].map((index) => ({
    kind: recordKind(job.type),
    externalId: `${key}-${index}`,
    occurredOn: '2026-11-01',
    amount: 10_000 * index,
    payload: {},
  }))
  return { ...(itemKey === undefined ? {} : { itemKey }), status: 'SUCCEEDED', records }
}

function recordKind(type: InstitutionType): ScrapedRecord['kind'] {
  switch (type) {
    case 'HOMETAX':
      return 'TAX_INVOICE'
    case 'CARD_SALES':
      return 'CARD_SALE'
    case 'CREDIT_CARD':
      return 'CARD_APPROVAL'
    case 'BANK':
    case 'SPEED_BANK':
      return 'BANK_TRANSACTION'
    case 'GIRO':
      return 'GIRO_BILL'
    case 'PG':
      return 'PG_SETTLEMENT'
    case 'DELIVERY':
    case 'ALLRA':
      return 'ONLINE_SALE'
  }
}
