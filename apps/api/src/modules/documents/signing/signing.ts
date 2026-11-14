import { randomBytes } from 'node:crypto'
import { Context, DateTime, Duration, Effect, Layer, Option, Result } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { keepChanges } from '../../../shared/persistence/unit-of-work.ts'
import { companyDate } from '../../../shared/time/company-date.ts'
import { HrDirectory } from '../../hr/hr.public.ts'
import {
  decideSignerVerification,
  decideSigningCompletion,
  effectiveStatus,
  planSigningCompletion,
  signerLinkStatus,
} from '../esign/esign-request.aggregate.ts'
import { hashToken } from '../esign/esign-requests.ts'
import { EsignRequestRepository, type EsignRequestRecord } from '../esign/esign-request.ts'
import type { EsignRequestStatus } from '../esign/esign-request-status.types.ts'
import { DocumentEvents, PdfRenderer, SignerIdentityVerifier } from '../shared/documents-ports.ts'
import { EsignTemplateRepository } from '../templates/esign-template.ts'
import { maskName, SIGNER_SESSION_MINUTES } from './signer-verification.ts'
import {
  EsignLinkNotFound,
  type EsignLinkClosed,
  type EsignVerificationFailed,
  type EsignVerificationLocked,
  type SignerSessionInvalid,
} from './signing-errors.ts'

/** 서명자가 본인확인 전에 보는 요약입니다. */
export interface SigningSummary {
  title: string
  recipientName: string
  status: EsignRequestStatus
  dueDate?: string
  documents: Array<{ index: number; title: string }>
}

/** 비로그인 서명자 흐름입니다. 링크 토큰으로 요청을 찾고, 본인확인 뒤 세션 토큰으로 서명을 마칩니다. */
export class Signing extends Context.Service<
  Signing,
  {
    summary(token: string): Effect.Effect<SigningSummary, EsignLinkNotFound>
    verify(
      token: string,
      claim: { name: string; birthDate?: string },
    ): Effect.Effect<
      { sessionToken: string; expiresAt: string },
      EsignLinkNotFound | EsignLinkClosed | EsignVerificationFailed | EsignVerificationLocked
    >
    complete(
      token: string,
      sessionToken: string | undefined,
      signerValues: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
    ): Effect.Effect<
      { status: 'COMPLETED'; resultFileId: Id<'file'> },
      EsignLinkNotFound | EsignLinkClosed | SignerSessionInvalid
    >
  }
>()('semu/documents/Signing') {
  static readonly layer = Layer.effect(
    Signing,
    Effect.gen(function* () {
      const requests = yield* EsignRequestRepository
      const templates = yield* EsignTemplateRepository
      const directory = yield* HrDirectory
      const verifier = yield* SignerIdentityVerifier
      const renderer = yield* PdfRenderer
      const events = yield* DocumentEvents

      const clock = DateTime.now.pipe(
        Effect.map((now) => ({ now, iso: DateTime.formatIso(now), today: companyDate(DateTime.toEpochMillis(now)) })),
      )

      const findByToken = (token: string) =>
        requests
          .findByLinkTokenHash(hashToken(token))
          .pipe(
            Effect.flatMap(
              Option.match({ onNone: () => Effect.fail(new EsignLinkNotFound({})), onSome: Effect.succeed }),
            ),
          )

      const loadTemplates = (record: EsignRequestRecord) =>
        Effect.forEach(record.templateIds, (id) => templates.find(id)).pipe(
          Effect.map((found) => found.map(Option.getOrUndefined)),
        )

      return Signing.of({
        summary: Effect.fn('Signing.summary')(function* (token) {
          const record = yield* findByToken(token)
          const { today } = yield* clock
          const found = yield* Effect.forEach(record.templateIds, (id) => templates.find(id))
          const summary: SigningSummary = {
            title: record.title,
            recipientName: maskName(record.recipient.name),
            status: effectiveStatus(record, today),
            documents: found.map((template, index) => ({
              index,
              title: Option.match(template, { onNone: () => '', onSome: (t) => t.title }),
            })),
          }
          if (record.dueDate !== undefined) summary.dueDate = record.dueDate
          return summary
        }),

        verify: Effect.fn('Signing.verify')(function* (token, claim) {
          const record = yield* findByToken(token)
          const now = yield* clock
          // 닫힌 링크면 본인확인을 부르지 않습니다.
          yield* Effect.fromResult(signerLinkStatus(record, now.today))
          const employee =
            record.recipient.employeeId === undefined
              ? undefined
              : Option.getOrUndefined(
                  yield* directory.findEmployee(record.companyId, record.recipient.employeeId, now.today),
                )
          const matches = yield* verifier.verify({ name: record.recipient.name, birthDate: employee?.birthDate }, claim)
          const sessionToken = randomBytes(24).toString('base64url')
          const expiresAt = DateTime.formatIso(DateTime.addDuration(now.now, Duration.minutes(SIGNER_SESSION_MINUTES)))
          const result = decideSignerVerification(
            record,
            { matches, session: { tokenHash: hashToken(sessionToken), expiresAt } },
            now,
          )
          if (Result.isFailure(result)) {
            const { error, keep } = result.failure
            if (keep !== undefined) {
              // 실패 응답(4xx)은 트랜잭션을 되돌리지만 실패 횟수는 남겨야 잠금이 걸립니다(M1).
              yield* requests.save(keep.request)
              yield* keepChanges
            }
            return yield* Effect.fail(error)
          }
          yield* requests.save(result.success.request)
          return { sessionToken, expiresAt }
        }),

        complete: Effect.fn('Signing.complete')(function* (token, sessionToken, signerValues) {
          const record = yield* findByToken(token)
          const now = yield* clock
          const found = yield* loadTemplates(record)
          const plan = yield* Effect.fromResult(
            planSigningCompletion(
              record,
              sessionToken === undefined ? undefined : hashToken(sessionToken),
              signerValues,
              found,
              now,
            ),
          )
          const resultFileId = yield* renderer.render({
            companyId: record.companyId,
            title: record.title,
            values: plan.fieldValues,
          })
          const decision = decideSigningCompletion(record, plan, found, resultFileId, now)
          yield* requests.save(decision.request)
          for (const event of decision.events) yield* events.publish(event)
          return { status: 'COMPLETED' as const, resultFileId }
        }),
      })
    }),
  )
}
