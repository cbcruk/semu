import { Clock, Context, Effect, Layer, Option } from 'effect'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { ValidationFailed } from '../../../shared/problem/problem.ts'
import { companyDate } from '../../../shared/time/company-date.ts'
import type { Actor } from '../../identity-access/actor.types.ts'
import { certificateStatus, isCertificateUsableFor } from '../certificates/certificate-eligibility.ts'
import type { CertificateStatus } from '../certificates/certificate-eligibility.types.ts'
import { CertificateRepository } from '../certificates/certificate-repository.ts'
import { CertificateNotFound } from '../certificates/certificate.ts'
import type { CertificateRecord } from '../certificates/certificate.ts'
import { CredentialVault } from '../credentials/credential-vault.ts'
import { ITEM_INSTITUTIONS, MAX_ITEMS_PER_TYPE, PG_KEY_SPECS } from '../institutions/institution.ts'
import type { AuthMethod, InstitutionType } from '../institutions/institution.ts'
import { CompanyProfiles } from '../ports/company-profiles.ts'
import { ScrapingGateway } from '../ports/scraping-gateway.ts'
import type { GatewayCandidate, GatewayCheck, GatewayCredential, GatewayLogin } from '../ports/scraping-gateway.ts'
import { IntegrationRepository } from './integration-repository.ts'
import {
  AuthMethodNotSupported,
  CertificateNotUsable,
  InstitutionCredentialRejected,
  IntegrationDuplicate,
  IntegrationItemNotFound,
  IntegrationLimitExceeded,
  IntegrationNotFound,
  PgKeysInvalid,
} from './integration.ts'
import type {
  Integration,
  IntegrationItem,
  IntegrationItemRecord,
  IntegrationRecord,
  IntegrationRegistration,
} from './integration.ts'
import { decideRegistration } from './registration-limits.ts'
import type { RegistrationViolation } from './registration-limits.types.ts'
import { isRetryable } from './scrap-retry.ts'

/** 연동 등록·후보 조회가 거절되는 이유입니다. */
export type RegistrationError =
  | ValidationFailed
  | AuthMethodNotSupported
  | IntegrationLimitExceeded
  | IntegrationDuplicate
  | PgKeysInvalid
  | InstitutionCredentialRejected
  | CertificateNotFound
  | CertificateNotUsable

/** 후보 하나입니다. */
export interface CandidateView {
  institutionCode: string
  key: string
  name: string
  numberMasked?: string
  isRegistered: boolean
}

/** 자격 증명 교체 입력입니다. */
export interface CredentialReplacementInput {
  password?: string
  certificateId?: Id<'certificate'>
  keys?: Readonly<Record<string, string>>
}

/** 연동 목록과 유형별 한도입니다. */
export interface IntegrationListView {
  items: Integration[]
  limits: Array<{ type: InstitutionType; max: number; used: number; unit: 'ITEM' | 'INTEGRATION' }>
}

const ITEM_KINDS: Partial<Record<InstitutionType, IntegrationItem['kind']>> = {
  CREDIT_CARD: 'CARD',
  BANK: 'ACCOUNT',
  DELIVERY: 'STORE',
  ALLRA: 'SCM',
}

const INSTITUTION_CODE_REQUIRED: ReadonlySet<InstitutionType> = new Set([
  'CREDIT_CARD',
  'BANK',
  'SPEED_BANK',
  'PG',
  'DELIVERY',
  'ALLRA',
])

const MASK = '********'

/** 카드·계좌 번호를 끝 4자리만 남기고 가립니다. */
export function maskNumber(number: string): string {
  return `****${number.slice(-4)}`
}

function missingFields(payload: Omit<IntegrationRegistration, 'itemKeys'>): string[] {
  const missing: string[] = []
  if (INSTITUTION_CODE_REQUIRED.has(payload.type) && (payload.institutionCodes ?? []).length === 0) {
    missing.push('institutionCodes')
  }
  const require = (field: keyof typeof payload) => {
    if (payload[field] === undefined) missing.push(field)
  }
  switch (payload.authMethod) {
    case 'ID_PASSWORD':
    case 'SPEED_LOOKUP':
      require('accountId')
      require('password')
      break
    case 'CERTIFICATE':
      require('certificateId')
      break
    case 'API_KEY':
      require('mid')
      require('keys')
      break
    case 'OAUTH':
      require('accountId')
      break
  }
  return missing
}

function violationError(violation: RegistrationViolation): RegistrationError {
  switch (violation.code) {
    case 'AUTH_METHOD_NOT_SUPPORTED':
      return new AuthMethodNotSupported({ field: violation.field })
    case 'SINGLE_INSTITUTION_REQUIRED':
      return new ValidationFailed({ violations: [{ field: violation.field, code: 'INVALID_VALUE' }] })
    case 'ITEM_LIMIT_EXCEEDED':
      return new IntegrationLimitExceeded({ field: violation.field, limit: violation.limit })
    case 'NO_NEW_ITEMS':
      return new IntegrationDuplicate({ reason: 'NO_NEW_ITEMS' })
    case 'INTEGRATION_DUPLICATE':
      return new IntegrationDuplicate({ reason: 'SAME_INTEGRATION' })
    case 'PG_COMPANY_UNKNOWN':
      return new PgKeysInvalid({ reason: 'UNKNOWN_PG_COMPANY', field: violation.field })
    case 'PG_MID_NOT_SUPPORTED':
      return new PgKeysInvalid({ reason: 'MID_NOT_SUPPORTED', field: violation.field })
    case 'PG_KEY_MISSING':
      return new PgKeysInvalid({ reason: 'KEY_MISSING', field: violation.field, missing: [...violation.missing] })
  }
}

function rejected(check: GatewayCheck): Effect.Effect<void, InstitutionCredentialRejected> {
  return check.ok
    ? Effect.void
    : Effect.fail(new InstitutionCredentialRejected({ reason: check.code, isRetryable: check.isRetryable }))
}

/** 저장한 연동을 응답 형태로 바꿉니다. 상태와 `allowedActions`를 여기서 정합니다. */
export function integrationView(record: IntegrationRecord, certificate: CertificateStatus | undefined): Integration {
  const certificateBroken = record.authMethod === 'CERTIFICATE' && certificate !== 'ACTIVE'
  const retryInput = {
    authMethod: record.authMethod,
    ...(certificate === undefined ? {} : { certificateStatus: certificate }),
  }
  const failedHard = record.lastScrap?.status === 'FAILED' && !record.lastScrap.isRetryable
  const canRetry = record.lastScrap?.status === 'FAILED' && isRetryable({ ...retryInput, lastScrap: record.lastScrap })
  const actions: Integration['allowedActions'][number][] = []
  if (!certificateBroken) actions.push('SCRAP')
  if (canRetry) actions.push('RETRY')
  if (record.authMethod !== 'OAUTH') actions.push('REPLACE_CREDENTIALS')
  actions.push('DELETE')
  const items = record.items.map((item): IntegrationItem => {
    const itemActions: IntegrationItem['allowedActions'][number][] = []
    if (
      item.isActive &&
      item.lastScrap?.status === 'FAILED' &&
      isRetryable({ ...retryInput, lastScrap: item.lastScrap })
    ) {
      itemActions.push('RETRY')
    }
    itemActions.push(item.isActive ? 'DEACTIVATE' : 'ACTIVATE', 'DELETE')
    return { ...item, allowedActions: itemActions }
  })
  const keys =
    record.publicKeys === undefined
      ? undefined
      : {
          ...record.publicKeys,
          ...Object.fromEntries((record.secretKeyNames ?? []).map((name) => [name, MASK])),
        }
  return {
    id: record.id,
    type: record.type,
    ...(record.institutionCode === undefined ? {} : { institutionCode: record.institutionCode }),
    authMethod: record.authMethod,
    isCorporate: record.isCorporate,
    ...(record.accountId === undefined ? {} : { accountId: record.accountId }),
    ...(record.certificateId === undefined ? {} : { certificateId: record.certificateId }),
    ...(certificate === undefined ? {} : { certificateStatus: certificate }),
    ...(keys === undefined ? {} : { keys }),
    items,
    canIssueTaxInvoice: record.canIssueTaxInvoice,
    usableForTaxFiling: record.usableForTaxFiling,
    ...(record.ipWhitelist === undefined ? {} : { ipWhitelist: record.ipWhitelist }),
    status: certificateBroken || failedHard ? 'ERROR' : 'ACTIVE',
    ...(record.lastScrap === undefined ? {} : { lastScrap: record.lastScrap }),
    allowedActions: actions,
    createdAt: record.createdAt,
    version: record.version,
  }
}

/** 이 연동이 쓰는 비밀 값입니다. PG는 비밀 키만, ID 로그인은 비밀번호만 봉합니다. */
function secretFields(
  authMethod: AuthMethod,
  input: { password?: string; keys?: Readonly<Record<string, string>> },
  secretKeyNames: ReadonlyArray<string>,
): Record<string, string> {
  if (authMethod === 'API_KEY') {
    return Object.fromEntries(
      secretKeyNames.flatMap((name) => (input.keys?.[name] === undefined ? [] : [[name, input.keys[name]]])),
    )
  }
  return input.password === undefined ? {} : { password: input.password }
}

/**
 * 기관 연동의 등록·조회·자격 증명 교체·삭제입니다. 권한 확인은 핸들러가 합니다.
 *
 * 자격 증명은 기관이 받는지 먼저 확인하고(동기), 통과한 것만 봉해 저장합니다. 첫 수집은 수집 요청으로 따로 만듭니다.
 */
export class Integrations extends Context.Service<
  Integrations,
  {
    list(actor: Actor, type?: InstitutionType): Effect.Effect<IntegrationListView>
    get(actor: Actor, integrationId: Id<'integration'>): Effect.Effect<Integration, IntegrationNotFound>
    listCandidates(
      actor: Actor,
      query: Omit<IntegrationRegistration, 'itemKeys'>,
    ): Effect.Effect<CandidateView[], RegistrationError>
    register(actor: Actor, registration: IntegrationRegistration): Effect.Effect<Integration, RegistrationError>
    replaceCredentials(
      actor: Actor,
      integrationId: Id<'integration'>,
      input: CredentialReplacementInput,
    ): Effect.Effect<
      Integration,
      | IntegrationNotFound
      | ValidationFailed
      | InstitutionCredentialRejected
      | CertificateNotFound
      | CertificateNotUsable
    >
    patchItem(
      actor: Actor,
      integrationId: Id<'integration'>,
      itemKey: string,
      patch: { isActive?: boolean; number?: string },
    ): Effect.Effect<Integration, IntegrationNotFound | IntegrationItemNotFound>
    removeItem(
      actor: Actor,
      integrationId: Id<'integration'>,
      itemKey: string,
    ): Effect.Effect<void, IntegrationNotFound | IntegrationItemNotFound>
    remove(actor: Actor, integrationId: Id<'integration'>): Effect.Effect<void, IntegrationNotFound>
  }
>()('semu/integrations/Integrations') {
  /** 저장소·금고·수집 어댑터·회사 정보 포트로 만듭니다. */
  static readonly layer = Layer.effect(
    Integrations,
    Effect.gen(function* () {
      const repository = yield* IntegrationRepository
      const certificates = yield* CertificateRepository
      const vault = yield* CredentialVault
      const gateway = yield* ScrapingGateway
      const profiles = yield* CompanyProfiles

      const today = Clock.currentTimeMillis.pipe(Effect.map(companyDate))
      const profileOf = (companyId: Id<'company'>) =>
        profiles.profileOf(companyId).pipe(Effect.map(Option.getOrThrow), Effect.orDie)

      const statusOf = (record: CertificateRecord | undefined, day: string): CertificateStatus | undefined =>
        record === undefined
          ? undefined
          : certificateStatus(
              { status: record.storedStatus, expiresOn: record.expiresOn, deleted: record.deletedAt !== undefined },
              day,
            )

      const view = Effect.fn(function* (record: IntegrationRecord) {
        if (record.certificateId === undefined) return integrationView(record, undefined)
        const certificate = yield* certificates.find(record.companyId, record.certificateId)
        const day = yield* today
        return integrationView(record, statusOf(Option.getOrUndefined(certificate), day) ?? 'UNREGISTERED')
      })

      const load = (actor: Actor, integrationId: Id<'integration'>) =>
        repository.find(actor.companyId, integrationId).pipe(
          Effect.flatMap(Effect.fromOption),
          Effect.mapError(() => new IntegrationNotFound({})),
        )

      /** 인증서 연동이면 인증서를 열어 확인합니다. 이 기관에 쓸 수 있고 지금 `ACTIVE`여야 합니다. */
      const usableCertificate = Effect.fn(function* (
        actor: Actor,
        type: InstitutionType,
        certificateId: Id<'certificate'>,
      ) {
        const found = yield* certificates.find(actor.companyId, certificateId)
        const record = Option.getOrUndefined(Option.filter(found, (c) => c.deletedAt === undefined))
        if (record === undefined) return yield* new CertificateNotFound({})
        const status = statusOf(record, yield* today)
        if (status !== 'ACTIVE') {
          return yield* new CertificateNotUsable({
            reason: 'NOT_ACTIVE',
            ...(status === undefined ? {} : { certificateStatus: status }),
          })
        }
        if (!isCertificateUsableFor(type, actor.businessType, record)) {
          return yield* new CertificateNotUsable({ reason: 'NOT_ALLOWED_FOR_INSTITUTION' })
        }
        const fields = yield* vault.open(record.secret)
        return { bundle: fields['bundle'] ?? '', signPassword: fields['signPassword'] ?? '' }
      })

      /** 요청 형식, 인증 방법, PG 키, 중복을 확인하고 기관 로그인 정보를 만듭니다. 항목 수 한도는 아직 보지 않습니다. */
      const prepare = Effect.fn(function* (actor: Actor, query: Omit<IntegrationRegistration, 'itemKeys'>) {
        const missing = missingFields(query)
        if (missing.length > 0) {
          return yield* new ValidationFailed({ violations: missing.map((field) => ({ field, code: 'REQUIRED' })) })
        }
        const existing = yield* repository.listByCompany(actor.companyId)
        const codes = query.institutionCodes ?? []
        const request = {
          type: query.type,
          authMethod: query.authMethod,
          institutionCodes: codes,
          isCorporate: query.isCorporate ?? actor.businessType === 'CORPORATION',
          ...(query.mid === undefined ? {} : { mid: query.mid }),
          ...(query.keys === undefined
            ? {}
            : { keyNames: Object.keys(query.keys).filter((name) => (query.keys?.[name] ?? '') !== '') }),
          ...(query.accountId === undefined ? {} : { accountId: query.accountId }),
        }
        const existingLinks = existing.map((link) => ({
          type: link.type,
          authMethod: link.authMethod,
          ...(link.institutionCode === undefined ? {} : { institutionCode: link.institutionCode }),
          ...(link.accountId === undefined ? {} : { accountKey: link.accountId }),
        }))
        const early = decideRegistration({ ...request, newItemCount: 1 }, { integrations: existingLinks, itemCount: 0 })
        if (!early.ok) return yield* violationError(early.violation)
        const certificate =
          query.certificateId === undefined
            ? undefined
            : yield* usableCertificate(actor, query.type, query.certificateId)
        const company = yield* profileOf(actor.companyId)
        const credential: GatewayCredential = {
          authMethod: query.authMethod,
          ...(query.accountId === undefined ? {} : { accountId: query.accountId }),
          ...(query.password === undefined ? {} : { password: query.password }),
          ...(query.keys === undefined ? {} : { keys: query.keys }),
          ...(certificate === undefined ? {} : { certificate }),
        }
        const login: GatewayLogin = {
          type: query.type,
          institutionCodes: codes,
          isCorporate: request.isCorporate,
          businessNumber: company.businessNumber,
          credential,
        }
        const registeredKeys = new Set(
          existing.filter((link) => link.type === query.type).flatMap((link) => link.items.map((item) => item.key)),
        )
        const itemCount = existing
          .filter((link) => link.type === query.type)
          .reduce((sum, link) => sum + link.items.filter((item) => item.isActive).length, 0)
        return { request, existingLinks, login, registeredKeys, itemCount }
      })

      const candidatesOf = Effect.fn(function* (login: GatewayLogin) {
        const { check, candidates } = yield* gateway.listCandidates(login)
        yield* rejected(check)
        return candidates
      })

      return Integrations.of({
        list: Effect.fn(function* (actor, type) {
          const records = yield* repository.listByCompany(actor.companyId, type)
          const all = type === undefined ? records : yield* repository.listByCompany(actor.companyId)
          const items = yield* Effect.forEach(records, view)
          const used = (of: InstitutionType) =>
            all
              .filter((link) => link.type === of)
              .reduce((sum, link) => sum + link.items.filter((item) => item.isActive).length, 0)
          return {
            items,
            limits: [
              { type: 'CREDIT_CARD', max: MAX_ITEMS_PER_TYPE, used: used('CREDIT_CARD'), unit: 'ITEM' },
              { type: 'BANK', max: MAX_ITEMS_PER_TYPE, used: used('BANK'), unit: 'ITEM' },
              { type: 'DELIVERY', max: MAX_ITEMS_PER_TYPE, used: used('DELIVERY'), unit: 'ITEM' },
              {
                type: 'PG',
                max: MAX_ITEMS_PER_TYPE,
                used: all.filter((link) => link.type === 'PG').length,
                unit: 'INTEGRATION',
              },
            ],
          }
        }),
        get: (actor, integrationId) => load(actor, integrationId).pipe(Effect.flatMap(view)),
        listCandidates: Effect.fn(function* (actor, query) {
          if (!ITEM_INSTITUTIONS.has(query.type)) {
            return yield* new ValidationFailed({ violations: [{ field: 'type', code: 'INVALID_VALUE' }] })
          }
          const prepared = yield* prepare(actor, query)
          const candidates = yield* candidatesOf(prepared.login)
          return candidates.map((candidate): CandidateView => ({
            institutionCode: candidate.institutionCode,
            key: candidate.key,
            name: candidate.name,
            ...(candidate.number === undefined ? {} : { numberMasked: maskNumber(candidate.number) }),
            isRegistered: prepared.registeredKeys.has(candidate.key),
          }))
        }),
        register: Effect.fn(function* (actor, registration) {
          const prepared = yield* prepare(actor, registration)
          const kind = ITEM_KINDS[registration.type]
          let newItems: GatewayCandidate[] = []
          if (kind === undefined) {
            yield* rejected(yield* gateway.verifyCredential(prepared.login))
          } else {
            const candidates = yield* candidatesOf(prepared.login)
            const chosen =
              registration.type === 'DELIVERY' || registration.type === 'ALLRA'
                ? candidates
                : candidates.filter((candidate) => (registration.itemKeys ?? []).includes(candidate.key))
            newItems = chosen.filter((candidate) => !prepared.registeredKeys.has(candidate.key))
          }
          const decision = decideRegistration(
            { ...prepared.request, newItemCount: newItems.length },
            { integrations: prepared.existingLinks, itemCount: prepared.itemCount },
          )
          if (!decision.ok) return yield* violationError(decision.violation)
          const code = prepared.request.institutionCodes[0]
          const spec = registration.type === 'PG' && code !== undefined ? PG_KEY_SPECS[code] : undefined
          const secretKeyNames = spec?.secret ?? []
          const secrets = secretFields(registration.authMethod, registration, secretKeyNames)
          const now = yield* Clock.currentTimeMillis
          const record: IntegrationRecord = {
            id: newId('integration', now),
            companyId: actor.companyId,
            type: registration.type,
            ...(prepared.request.institutionCodes.length === 1 && code !== undefined ? { institutionCode: code } : {}),
            authMethod: registration.authMethod,
            isCorporate: prepared.request.isCorporate,
            ...(registration.type === 'PG' && registration.mid !== undefined
              ? { accountId: registration.mid }
              : registration.accountId === undefined
                ? {}
                : { accountId: registration.accountId }),
            ...(registration.certificateId === undefined ? {} : { certificateId: registration.certificateId }),
            ...(registration.type === 'PG'
              ? {
                  publicKeys: Object.fromEntries(
                    Object.entries(registration.keys ?? {}).filter(([name]) => !secretKeyNames.includes(name)),
                  ),
                  secretKeyNames,
                }
              : {}),
            ...(Object.keys(secrets).length === 0 ? {} : { credential: yield* vault.seal(secrets) }),
            items: newItems.map((candidate): IntegrationItemRecord => ({
              key: candidate.key,
              kind: kind ?? 'CARD',
              institutionCode: candidate.institutionCode,
              name: candidate.name,
              ...(candidate.number === undefined ? {} : { numberMasked: maskNumber(candidate.number) }),
              isActive: true,
            })),
            canIssueTaxInvoice: decision.canIssueTaxInvoice,
            usableForTaxFiling: decision.usableForTaxFiling,
            ...(decision.ipWhitelist === undefined ? {} : { ipWhitelist: decision.ipWhitelist }),
            createdAt: new Date(now).toISOString(),
            version: 1,
          }
          yield* repository.save(record)
          return yield* view(record)
        }),
        replaceCredentials: Effect.fn(function* (actor, integrationId, input) {
          const record = yield* load(actor, integrationId)
          const missing =
            record.authMethod === 'CERTIFICATE'
              ? input.certificateId === undefined
                ? ['certificateId']
                : []
              : record.authMethod === 'API_KEY'
                ? input.keys === undefined
                  ? ['keys']
                  : []
                : input.password === undefined
                  ? ['password']
                  : []
          if (missing.length > 0 || record.authMethod === 'OAUTH') {
            return yield* new ValidationFailed({
              violations: (missing.length > 0 ? missing : ['authMethod']).map((field) => ({
                field,
                code: missing.length > 0 ? 'REQUIRED' : 'INVALID_VALUE',
              })),
            })
          }
          const certificate =
            input.certificateId === undefined
              ? undefined
              : yield* usableCertificate(actor, record.type, input.certificateId)
          const current = record.credential === undefined ? {} : yield* vault.open(record.credential)
          const keys = { ...record.publicKeys, ...current, ...input.keys }
          const company = yield* profileOf(actor.companyId)
          yield* rejected(
            yield* gateway.verifyCredential({
              type: record.type,
              institutionCodes: record.institutionCode === undefined ? [] : [record.institutionCode],
              isCorporate: record.isCorporate,
              businessNumber: company.businessNumber,
              credential: {
                authMethod: record.authMethod,
                ...(record.accountId === undefined ? {} : { accountId: record.accountId }),
                ...(input.password === undefined ? {} : { password: input.password }),
                ...(record.authMethod === 'API_KEY' ? { keys } : {}),
                ...(certificate === undefined ? {} : { certificate }),
              },
            }),
          )
          const secrets = secretFields(record.authMethod, { ...input, keys }, record.secretKeyNames ?? [])
          const { lastScrap: _, credential: __, ...rest } = record
          const next: IntegrationRecord = {
            ...rest,
            ...(input.certificateId === undefined ? {} : { certificateId: input.certificateId }),
            ...(record.authMethod === 'API_KEY'
              ? {
                  publicKeys: Object.fromEntries(
                    Object.entries(keys).filter(([name]) => !(record.secretKeyNames ?? []).includes(name)),
                  ),
                }
              : {}),
            ...(Object.keys(secrets).length === 0 ? {} : { credential: yield* vault.seal(secrets) }),
            version: record.version + 1,
          }
          yield* repository.save(next)
          return yield* view(next)
        }),
        patchItem: Effect.fn(function* (actor, integrationId, itemKey, patch) {
          const record = yield* load(actor, integrationId)
          const item = record.items.find((candidate) => candidate.key === itemKey)
          if (item === undefined) return yield* new IntegrationItemNotFound({})
          const changed: IntegrationItemRecord = {
            ...item,
            ...(patch.isActive === undefined ? {} : { isActive: patch.isActive }),
            ...(patch.number === undefined ? {} : { numberMasked: maskNumber(patch.number) }),
          }
          const next = {
            ...record,
            items: record.items.map((candidate) => (candidate.key === itemKey ? changed : candidate)),
            version: record.version + 1,
          }
          yield* repository.save(next)
          return yield* view(next)
        }),
        removeItem: Effect.fn(function* (actor, integrationId, itemKey) {
          const record = yield* load(actor, integrationId)
          if (!record.items.some((item) => item.key === itemKey)) return yield* new IntegrationItemNotFound({})
          yield* repository.save({
            ...record,
            items: record.items.filter((item) => item.key !== itemKey),
            version: record.version + 1,
          })
        }),
        remove: Effect.fn(function* (actor, integrationId) {
          yield* load(actor, integrationId)
          yield* repository.remove(actor.companyId, integrationId)
        }),
      })
    }),
  )
}
