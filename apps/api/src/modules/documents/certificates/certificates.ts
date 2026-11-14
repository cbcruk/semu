import { randomBytes } from 'node:crypto'
import { Context, DateTime, Duration, Effect, Layer, Option } from 'effect'
import { paginate, type PageOf, type PageQuery } from '../../../shared/http/pagination.ts'
import { checkVersion } from '../../../shared/http/versioning.ts'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { VersionMismatch } from '../../../shared/problem/problem.ts'
import { companyDate } from '../../../shared/time/company-date.ts'
import { HrDirectory } from '../../hr/hr.public.ts'
import type { Actor } from '../../identity-access/actor.types.ts'
import { DocumentEvents, DocumentNotifier, type DocumentEvent } from '../shared/documents-ports.ts'
import { stripUndefined } from '../../../shared/http/strip-undefined.ts'
import { EsignTemplateRepository } from '../templates/esign-template.ts'
import {
  CertificateIssuanceRepository,
  CertificateNotFound,
  type CertificateInvalid,
  type CertificateTransitionInvalid,
  type CertificateIssuance,
  type CertificateIssuanceRecord,
  type IssueCertificate,
} from './certificate-issuance.ts'
import {
  decideCertificateIssuance,
  decideCertificateSend,
  decideCertificateVoid,
  planCertificateSend,
} from './certificate-issuance.aggregate.ts'
import { allowedCertificateActions, CERTIFICATE_LINK_DAYS } from './certificate-rules.ts'

/** 증명서 링크 주소입니다. */
export const CERTIFICATE_URL_BASE = 'https://app.semu.kr/certificates/'

type CommandError = CertificateNotFound | CertificateTransitionInvalid | VersionMismatch

/** 제증명(재직·경력·퇴직증명서) 발급과 발송입니다. 지우지 않고 무효로 남깁니다. */
export class Certificates extends Context.Service<
  Certificates,
  {
    list(actor: Actor, query: PageQuery): Effect.Effect<PageOf<CertificateIssuance>>
    get(actor: Actor, id: Id<'certificateIssuance'>): Effect.Effect<CertificateIssuance, CertificateNotFound>
    issue(actor: Actor, input: typeof IssueCertificate.Type): Effect.Effect<CertificateIssuance, CertificateInvalid>
    send(
      actor: Actor,
      id: Id<'certificateIssuance'>,
      expectedVersion: number | undefined,
    ): Effect.Effect<CertificateIssuance, CommandError | CertificateInvalid>
    void(
      actor: Actor,
      id: Id<'certificateIssuance'>,
      expectedVersion: number | undefined,
    ): Effect.Effect<CertificateIssuance, CommandError>
  }
>()('semu/documents/Certificates') {
  static readonly layer = Layer.effect(
    Certificates,
    Effect.gen(function* () {
      const issuances = yield* CertificateIssuanceRepository
      const templates = yield* EsignTemplateRepository
      const directory = yield* HrDirectory
      const notifier = yield* DocumentNotifier
      const events = yield* DocumentEvents

      const clock = DateTime.now.pipe(
        Effect.map((now) => ({ now, iso: DateTime.formatIso(now), today: companyDate(DateTime.toEpochMillis(now)) })),
      )

      const toView = ({ companyId: _, ...record }: CertificateIssuanceRecord): CertificateIssuance => ({
        ...stripUndefined(record),
        allowedActions: allowedCertificateActions(record.status),
      })

      const find = (actor: Actor, id: Id<'certificateIssuance'>) =>
        issuances
          .find(actor.companyId, id)
          .pipe(
            Effect.flatMap(
              Option.match({ onNone: () => Effect.fail(new CertificateNotFound({})), onSome: Effect.succeed }),
            ),
          )

      const save = (decision: { issuance: CertificateIssuanceRecord; events?: ReadonlyArray<DocumentEvent> }) =>
        Effect.gen(function* () {
          yield* issuances.save(decision.issuance)
          for (const event of decision.events ?? []) yield* events.publish(event)
          return toView(decision.issuance)
        })

      return Certificates.of({
        list: Effect.fn('Certificates.list')(function* (actor, query) {
          const all = (yield* issuances.list(actor.companyId)).map(toView)
          return paginate(all, (view) => view.id, query, { includeTotal: true })
        }),

        get: (actor, id) => find(actor, id).pipe(Effect.map(toView)),

        issue: Effect.fn('Certificates.issue')(function* (actor, input) {
          const now = yield* clock
          const template = Option.getOrUndefined(yield* templates.find(input.templateId))
          const employee = Option.getOrUndefined(
            yield* directory.findEmployee(actor.companyId, input.employeeId, now.today),
          )
          const issuedNumbers = (yield* issuances.list(actor.companyId)).map((record) => record.issueNumber)
          const decision = yield* Effect.fromResult(
            decideCertificateIssuance(
              {
                id: newId('certificateIssuance'),
                companyId: actor.companyId,
                templateId: input.templateId,
                employeeId: input.employeeId,
                purpose: input.purpose,
                recipientEmail: input.recipientEmail,
                issuedAt: now.iso,
                year: Number(now.today.slice(0, 4)),
              },
              { template, employee, issuedNumbers },
            ),
          )
          return yield* save(decision)
        }),

        send: Effect.fn('Certificates.send')(function* (actor, id, expectedVersion) {
          const now = yield* clock
          const record = yield* find(actor, id)
          yield* checkVersion(record.version, expectedVersion)
          const { recipientEmail } = yield* Effect.fromResult(planCertificateSend(record))
          const token = randomBytes(24).toString('base64url')
          const template = Option.getOrUndefined(yield* templates.find(record.templateId))
          const delivery = yield* notifier.sendCertificateLink({
            companyId: actor.companyId,
            email: recipientEmail,
            title: template?.title ?? '증명서',
            url: `${CERTIFICATE_URL_BASE}${token}`,
          })
          const decision = yield* Effect.fromResult(
            decideCertificateSend(record, {
              delivered: delivery.ok,
              sentAt: now.iso,
              linkExpiresAt: DateTime.formatIso(DateTime.addDuration(now.now, Duration.days(CERTIFICATE_LINK_DAYS))),
            }),
          )
          return yield* save(decision)
        }),

        void: Effect.fn('Certificates.void')(function* (actor, id, expectedVersion) {
          const now = yield* clock
          const record = yield* find(actor, id)
          yield* checkVersion(record.version, expectedVersion)
          return yield* save(yield* Effect.fromResult(decideCertificateVoid(record, now.iso)))
        }),
      })
    }),
  )
}
