import { randomBytes } from 'node:crypto'
import { Context, DateTime, Duration, Effect, Layer, Option, Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { problemType } from '../../../shared/problem/problem.ts'
import { companyDate } from '../../../shared/time/company-date.ts'
import { HrDirectory } from '../../hr/hr.public.ts'
import { effectiveStatus, hashToken } from '../esign/esign-requests.ts'
import { EsignRequestRepository, EsignRequestStatusSchema, type EsignRequestRecord } from '../esign/esign-request.ts'
import { isLinkClosed, transitionEsignRequest } from '../esign/esign-request-status.ts'
import type { EsignRequestStatus } from '../esign/esign-request-status.types.ts'
import { DocumentEvents, PdfRenderer, SignerIdentityVerifier } from '../shared/documents-ports.ts'
import { EsignTemplateRepository } from '../templates/esign-template.ts'
import { decideVerification, maskName, SIGNER_SESSION_MINUTES } from './signer-verification.ts'

/** 링크 토큰에 맞는 요청이 없습니다. */
export class EsignLinkNotFound extends HttpApiError.Problem<EsignLinkNotFound>()(
  'EsignLinkNotFound',
  { type: problemType('ESIGN_LINK_NOT_FOUND'), status: 404, title: 'Signing link not found' },
  { code: Schema.tag('ESIGN_LINK_NOT_FOUND') },
) {}

/** 요청이 닫혀(초안·취소·무효·만료·발송 실패·완료) 서명할 수 없습니다. */
export class EsignLinkClosed extends HttpApiError.Problem<EsignLinkClosed>()(
  'EsignLinkClosed',
  { type: problemType('ESIGN_LINK_CLOSED'), status: 409, title: 'Signing link is closed' },
  { code: Schema.tag('ESIGN_LINK_CLOSED'), currentStatus: EsignRequestStatusSchema },
) {}

/** 이름이나 생년월일이 맞지 않습니다. */
export class EsignVerificationFailed extends HttpApiError.Problem<EsignVerificationFailed>()(
  'EsignVerificationFailed',
  { type: problemType('ESIGN_VERIFICATION_FAILED'), status: 422, title: 'Identity does not match' },
  { code: Schema.tag('ESIGN_VERIFICATION_FAILED'), remainingAttempts: Schema.Int },
) {}

/** 본인확인을 다섯 번 틀려 링크가 잠겼습니다. 관리자가 다시 보내야 합니다. */
export class EsignVerificationLocked extends HttpApiError.Problem<EsignVerificationLocked>()(
  'EsignVerificationLocked',
  { type: problemType('ESIGN_VERIFICATION_LOCKED'), status: 429, title: 'Too many failed verifications' },
  { code: Schema.tag('ESIGN_VERIFICATION_LOCKED') },
) {}

/** 서명자 세션이 없거나 만료됐습니다. 본인확인을 다시 합니다. */
export class SignerSessionInvalid extends HttpApiError.Problem<SignerSessionInvalid>()(
  'SignerSessionInvalid',
  { type: problemType('SIGNER_SESSION_INVALID'), status: 401, title: 'Signer session required' },
  { code: Schema.tag('SIGNER_SESSION_INVALID') },
) {}

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
          .findAcrossCompanies((record) => record.linkTokenHash === hashToken(token))
          .pipe(
            Effect.flatMap(
              Option.match({ onNone: () => Effect.fail(new EsignLinkNotFound({})), onSome: Effect.succeed }),
            ),
          )

      const requireOpen = (record: EsignRequestRecord, today: string) => {
        const status = effectiveStatus(record, today)
        return isLinkClosed(status) || status === 'COMPLETED'
          ? Effect.fail(new EsignLinkClosed({ currentStatus: status }))
          : Effect.succeed(status)
      }

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
          const status = yield* requireOpen(record, now.today)
          const employee =
            record.recipient.employeeId === undefined
              ? undefined
              : Option.getOrUndefined(
                  yield* directory.findEmployee(record.companyId, record.recipient.employeeId, now.today),
                )
          const matches = yield* verifier.verify({ name: record.recipient.name, birthDate: employee?.birthDate }, claim)
          const decision = decideVerification({ failures: record.verifyFailures, matches })
          if (decision.outcome === 'LOCKED') return yield* new EsignVerificationLocked({})
          if (decision.outcome === 'FAILED') {
            yield* requests.save({ ...record, verifyFailures: decision.failures })
            return yield* new EsignVerificationFailed({ remainingAttempts: decision.remainingAttempts })
          }
          const sessionToken = randomBytes(24).toString('base64url')
          const expiresAt = DateTime.formatIso(DateTime.addDuration(now.now, Duration.minutes(SIGNER_SESSION_MINUTES)))
          const moved = transitionEsignRequest(status, 'VERIFY_SIGNER')
          yield* requests.save({
            ...record,
            status: moved.ok && moved.to !== 'DELETED' ? moved.to : status,
            verifyFailures: 0,
            sessions: [
              ...record.sessions.filter((session) => session.expiresAt > now.iso),
              { tokenHash: hashToken(sessionToken), expiresAt },
            ],
            version: record.version + 1,
            updatedAt: now.iso,
          })
          return { sessionToken, expiresAt }
        }),

        complete: Effect.fn('Signing.complete')(function* (token, sessionToken, signerValues) {
          const record = yield* findByToken(token)
          const now = yield* clock
          const status = yield* requireOpen(record, now.today)
          const live =
            sessionToken !== undefined &&
            record.sessions.some(
              (session) => session.tokenHash === hashToken(sessionToken) && session.expiresAt > now.iso,
            )
          if (!live) return yield* new SignerSessionInvalid({})
          const moved = transitionEsignRequest(status, 'COMPLETE')
          if (!moved.ok || moved.to === 'DELETED') return yield* new EsignLinkClosed({ currentStatus: status })
          const fieldValues: Record<string, Readonly<Record<string, unknown>>> = { ...record.fieldValues }
          for (const [index, values] of Object.entries(signerValues)) {
            fieldValues[index] = { ...fieldValues[index], ...values }
          }
          const resultFileId = yield* renderer.render({
            companyId: record.companyId,
            title: record.title,
            values: fieldValues,
          })
          yield* requests.save({
            ...record,
            status: moved.to,
            fieldValues,
            completedAt: now.iso,
            resultFileId,
            sessions: [],
            version: record.version + 1,
            updatedAt: now.iso,
          })
          const kinds = yield* Effect.forEach(record.templateIds, (id) => templates.find(id))
          yield* events.publish({
            type: 'esign-request.completed',
            companyId: record.companyId,
            requestId: record.id,
            ...(record.recipient.employeeId === undefined ? {} : { employeeId: record.recipient.employeeId }),
            documentKinds: kinds.flatMap((template) => (Option.isSome(template) ? [template.value.kind] : [])),
            resultFileId,
            at: now.iso,
          })
          return { status: 'COMPLETED' as const, resultFileId }
        }),
      })
    }),
  )
}
