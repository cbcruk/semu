import { Context, Effect, Layer } from 'effect'
import { FileStore } from '../../../shared/files/file-store.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { identityMatches } from '../signing/signer-verification.ts'
import { minimalPdf } from './minimal-pdf.ts'
import type { signedTermsOf } from '../signing/signed-terms.ts'
import type { DocumentKind, SignedTerms } from '../signing/signed-terms.types.ts'

/** 발송 결과입니다. 실패하면 요청이 `SEND_FAILED`가 됩니다. */
export interface DeliveryResult {
  ok: boolean
}

/** 서명 링크·증명서 링크를 메일·알림톡으로 보내는 포트입니다. */
export class DocumentNotifier extends Context.Service<
  DocumentNotifier,
  {
    sendSigningLink(message: {
      companyId: Id<'company'>
      email: string
      title: string
      url: string
    }): Effect.Effect<DeliveryResult>
    sendCertificateLink(message: {
      companyId: Id<'company'>
      email: string
      title: string
      url: string
    }): Effect.Effect<DeliveryResult>
  }
>()('semu/documents/DocumentNotifier') {
  /** 보낸 것처럼 성공만 돌려줍니다. 주소가 `fail@`로 시작하면 실패합니다. */
  static readonly layerFake = Layer.succeed(
    DocumentNotifier,
    DocumentNotifier.of({
      sendSigningLink: (message) => Effect.succeed({ ok: !message.email.startsWith('fail@') }),
      sendCertificateLink: (message) => Effect.succeed({ ok: !message.email.startsWith('fail@') }),
    }),
  )
}

/** 서명 완료 문서·증명서 PDF를 만들어 파일로 저장하는 포트입니다. */
export class PdfRenderer extends Context.Service<
  PdfRenderer,
  { render(input: { companyId: Id<'company'>; title: string; values: unknown }): Effect.Effect<Id<'file'>> }
>()('semu/documents/PdfRenderer') {
  /**
   * 제목과 입력값을 글자로 적은 한 쪽짜리 PDF({@link minimalPdf})를 공통 파일 저장소에 넣습니다. 서식 렌더러가 생기기 전까지 씁니다.
   * 서버가 만든 파일이라 올린 사람(`createdBy`)은 없습니다.
   */
  static readonly layerMinimal = Layer.effect(
    PdfRenderer,
    Effect.gen(function* () {
      const files = yield* FileStore
      return PdfRenderer.of({
        render: (input) =>
          Effect.map(
            files.put({
              companyId: input.companyId,
              name: `${input.title}.pdf`,
              contentType: 'application/pdf',
              bytes: minimalPdf(input.title, valueLines(input.values)),
              createdBy: null,
            }),
            (file) => file.id,
          ),
      })
    }),
  )
}

/** 입력값을 `키: 값` 줄로 펼칩니다. 템플릿마다 값이 묶여 있으면(`{ "0": {...} }`) 그대로 한 단계 들어갑니다. */
function valueLines(values: unknown, prefix = ''): string[] {
  if (values === null || typeof values !== 'object') return [`${prefix}${String(values)}`]
  return Object.entries(values).flatMap(([key, value]) =>
    value !== null && typeof value === 'object'
      ? valueLines(value, `${prefix}${key}.`)
      : [`${prefix}${key}: ${String(value)}`],
  )
}

/** 서명자 본인확인 포트입니다. 지금은 이름·생년월일 비교이고, 휴대폰 본인인증으로 바꿀 수 있습니다. */
export class SignerIdentityVerifier extends Context.Service<
  SignerIdentityVerifier,
  {
    verify(
      expected: { name: string; birthDate?: string | undefined },
      claim: { name: string; birthDate?: string | undefined },
    ): Effect.Effect<boolean>
  }
>()('semu/documents/SignerIdentityVerifier') {
  /** 이름(공백 무시)과 생년월일을 그대로 비교합니다. */
  static readonly layerNameAndBirthDate = Layer.succeed(
    SignerIdentityVerifier,
    SignerIdentityVerifier.of({ verify: (expected, claim) => Effect.succeed(identityMatches(expected, claim)) }),
  )
}

/** 서명 완료 요청에 든 문서 하나입니다. 순서는 요청의 템플릿 순서입니다. */
export interface SignedDocumentSummary {
  index: number
  kind: DocumentKind
  title: string
  /** 인사 기록에 이어 붙일 계약 조건입니다({@link signedTermsOf}). */
  terms: SignedTerms
}

/** 문서 컨텍스트가 내는 도메인 이벤트입니다. */
export type DocumentEvent =
  | { type: 'esign_request.sent'; companyId: Id<'company'>; requestId: Id<'esignRequest'>; at: string }
  | {
      type: 'esign_request.completed'
      companyId: Id<'company'>
      requestId: Id<'esignRequest'>
      /** 수신자가 직원이면 있습니다. 신규 계약자는 없습니다. */
      employeeId?: Id<'employee'>
      title: string
      documents: ReadonlyArray<SignedDocumentSummary>
      resultFileId: Id<'file'>
      at: string
    }
  /** 완료한 요청을 `:void`로 무효로 했습니다. 완료본 파일은 남습니다. */
  | { type: 'esign_request.voided'; companyId: Id<'company'>; requestId: Id<'esignRequest'>; at: string }
  | { type: 'certificate.issued'; companyId: Id<'company'>; issuanceId: Id<'certificateIssuance'>; at: string }

/**
 * 도메인 이벤트를 내보내는 포트입니다. 앱은 outbox로 HR에 넘기는 구현(`src/wiring/documents-hr.ts`)을 넣습니다.
 * 소비자는 같은 이벤트를 두 번 받아도 같은 결과여야 합니다.
 */
export class DocumentEvents extends Context.Service<
  DocumentEvents,
  { publish(event: DocumentEvent): Effect.Effect<void> }
>()('semu/documents/DocumentEvents') {
  /** 받는 곳 없이 버립니다. 문서 컨텍스트만 띄울 때 씁니다. */
  static readonly layerDiscard = Layer.succeed(DocumentEvents, DocumentEvents.of({ publish: () => Effect.void }))
}
