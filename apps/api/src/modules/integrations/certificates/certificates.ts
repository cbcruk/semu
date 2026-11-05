import { Clock, Context, Effect, Layer, Option } from 'effect'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { companyDate } from '../../../shared/time/company-date.ts'
import type { Actor } from '../../identity-access/actor.types.ts'
import { CredentialVault } from '../credentials/credential-vault.ts'
import { IntegrationRepository } from '../integrations/integration-repository.ts'
import { CertificateNotUsable } from '../integrations/integration.ts'
import { CompanyProfiles } from '../ports/company-profiles.ts'
import { ScrapingGateway } from '../ports/scraping-gateway.ts'
import {
  certificateStatus,
  decideCertificateRegistration,
  isCertificateUsableFor,
  remainingDays,
  usableInstitutions,
} from './certificate-eligibility.ts'
import type { CertificateCompany, CertificateRejection } from './certificate-eligibility.types.ts'
import { CertificateRepository } from './certificate-repository.ts'
import {
  CertificateDuplicate,
  CertificateNotAccepted,
  CertificateNotFound,
  CertificatePasswordIncorrect,
  GiroSignupRejected,
} from './certificate.ts'
import type { CertificateRecord, CertificateUpload, SigningCertificate } from './certificate.ts'

const REJECTION_REASONS: Readonly<Record<CertificateRejection['code'], CertificateNotAccepted['reason']>> = {
  CERTIFICATE_OID_UNKNOWN: 'OID_UNKNOWN',
  CERTIFICATE_EXPIRED: 'EXPIRED',
  CERTIFICATE_TYPE_NOT_ALLOWED: 'TYPE_NOT_ALLOWED',
  CERTIFICATE_OWNER_MISMATCH: 'OWNER_MISMATCH',
}

/** 인터넷지로 간편가입 입력입니다. */
export interface GiroSignupInput {
  giroLoginId: string
  giroPassword: string
  email: string
  phone: string
}

/** 공동인증서 등록·조회·삭제와 서명 비밀번호 확인입니다. 권한 확인은 핸들러가 합니다. */
export class Certificates extends Context.Service<
  Certificates,
  {
    list(actor: Actor): Effect.Effect<SigningCertificate[]>
    register(
      actor: Actor,
      upload: CertificateUpload,
    ): Effect.Effect<SigningCertificate, CertificateNotAccepted | CertificateDuplicate | CertificatePasswordIncorrect>
    remove(actor: Actor, certificateId: Id<'certificate'>): Effect.Effect<void, CertificateNotFound>
    verifyPassword(
      actor: Actor,
      certificateId: Id<'certificate'>,
      signPassword: string,
    ): Effect.Effect<void, CertificateNotFound | CertificatePasswordIncorrect>
    joinGiro(
      actor: Actor,
      certificateId: Id<'certificate'>,
      input: GiroSignupInput,
    ): Effect.Effect<void, CertificateNotFound | CertificateNotUsable | GiroSignupRejected>
  }
>()('semu/integrations/Certificates') {
  /** 저장소·금고·수집 어댑터·회사 정보 포트로 만듭니다. */
  static readonly layer = Layer.effect(
    Certificates,
    Effect.gen(function* () {
      const repository = yield* CertificateRepository
      const integrations = yield* IntegrationRepository
      const vault = yield* CredentialVault
      const gateway = yield* ScrapingGateway
      const profiles = yield* CompanyProfiles

      const today = Clock.currentTimeMillis.pipe(Effect.map(companyDate))
      const profileOf = (companyId: Id<'company'>) =>
        profiles.profileOf(companyId).pipe(Effect.map(Option.getOrThrow), Effect.orDie)

      const view = Effect.fn(function* (record: CertificateRecord, company: CertificateCompany, day: string) {
        const linked = yield* integrations.listByCompany(record.companyId)
        const status = certificateStatus(
          { status: record.storedStatus, expiresOn: record.expiresOn, deleted: record.deletedAt !== undefined },
          day,
        )
        return {
          id: record.id,
          name: record.name,
          ownerType: record.ownerType,
          usage: record.usage,
          issuerCode: record.issuerCode,
          serialNumber: record.serialNumber,
          issuedOn: record.issuedOn,
          expiresOn: record.expiresOn,
          status,
          remainingDays: remainingDays(record.expiresOn, day),
          usableFor: status === 'ACTIVE' ? usableInstitutions(company.businessType, record) : [],
          linkedIntegrationIds: linked.filter((link) => link.certificateId === record.id).map((link) => link.id),
          registeredAt: record.registeredAt,
        } satisfies SigningCertificate
      })

      const load = (actor: Actor, certificateId: Id<'certificate'>) =>
        repository.find(actor.companyId, certificateId).pipe(
          Effect.map(Option.filter((found) => found.deletedAt === undefined)),
          Effect.flatMap(Effect.fromOption),
          Effect.mapError(() => new CertificateNotFound({})),
        )

      const secretOf = (record: CertificateRecord) =>
        vault
          .open(record.secret)
          .pipe(
            Effect.map((fields) => ({ bundle: fields['bundle'] ?? '', signPassword: fields['signPassword'] ?? '' })),
          )

      return Certificates.of({
        list: Effect.fn(function* (actor) {
          const company = yield* profileOf(actor.companyId)
          const day = yield* today
          const records = yield* repository.listByCompany(actor.companyId)
          return yield* Effect.forEach(records, (record) => view(record, company, day))
        }),
        register: Effect.fn(function* (actor, upload) {
          const company = yield* profileOf(actor.companyId)
          const now = yield* Clock.currentTimeMillis
          const day = companyDate(now)
          const decision = decideCertificateRegistration(
            company,
            {
              oid: upload.oid,
              expiresOn: upload.expiresOn,
              ...(upload.ownerBusinessNumber === undefined ? {} : { ownerBusinessNumber: upload.ownerBusinessNumber }),
              ...(upload.ownerName === undefined ? {} : { ownerName: upload.ownerName }),
            },
            day,
          )
          if (!decision.ok) {
            return yield* new CertificateNotAccepted({
              reason: REJECTION_REASONS[decision.rejection.code],
              field: decision.rejection.field,
            })
          }
          const duplicate = yield* repository.findBySerial(actor.companyId, upload.serialNumber)
          if (Option.isSome(duplicate)) return yield* new CertificateDuplicate({ certificateId: duplicate.value.id })
          const passwordOk = yield* gateway.checkCertificatePassword({
            bundle: upload.encryptedBundle,
            signPassword: upload.signPassword,
          })
          if (!passwordOk) return yield* new CertificatePasswordIncorrect({})
          const record: CertificateRecord = {
            id: newId('certificate', now),
            companyId: actor.companyId,
            name: upload.name,
            oid: upload.oid,
            ownerType: decision.ownerType,
            usage: decision.usage,
            issuerCode: decision.issuerCode,
            serialNumber: upload.serialNumber,
            issuedOn: upload.issuedOn,
            expiresOn: upload.expiresOn,
            storedStatus: 'ACTIVE',
            secret: yield* vault.seal({ bundle: upload.encryptedBundle, signPassword: upload.signPassword }),
            registeredBy: actor.userId,
            registeredAt: new Date(now).toISOString(),
          }
          yield* repository.save(record)
          return yield* view(record, company, day)
        }),
        remove: Effect.fn(function* (actor, certificateId) {
          const record = yield* load(actor, certificateId)
          const now = yield* Clock.currentTimeMillis
          yield* repository.save({ ...record, deletedAt: new Date(now).toISOString() })
        }),
        verifyPassword: Effect.fn(function* (actor, certificateId, signPassword) {
          const record = yield* load(actor, certificateId)
          const stored = yield* secretOf(record)
          if (stored.signPassword !== signPassword) return yield* new CertificatePasswordIncorrect({})
        }),
        joinGiro: Effect.fn(function* (actor, certificateId, input) {
          const record = yield* load(actor, certificateId)
          const company = yield* profileOf(actor.companyId)
          const day = yield* today
          const status = certificateStatus(
            { status: record.storedStatus, expiresOn: record.expiresOn, deleted: false },
            day,
          )
          if (status !== 'ACTIVE') {
            return yield* new CertificateNotUsable({ reason: 'NOT_ACTIVE', certificateStatus: status })
          }
          if (!isCertificateUsableFor('GIRO', company.businessType, record)) {
            return yield* new CertificateNotUsable({ reason: 'NOT_ALLOWED_FOR_INSTITUTION' })
          }
          const outcome = yield* gateway.joinGiro({ certificate: yield* secretOf(record), ...input })
          if (!outcome.ok) return yield* new GiroSignupRejected({ reason: outcome.code })
        }),
      })
    }),
  )
}
