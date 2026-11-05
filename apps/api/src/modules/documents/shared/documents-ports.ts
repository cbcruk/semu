import { createHash } from 'node:crypto'
import { Context, Effect, Layer, Ref } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { identityMatches } from '../signing/signer-verification.ts'

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
  /** 입력의 해시로 결정적인 파일 ID를 돌려줍니다. */
  static readonly layerFake = Layer.succeed(
    PdfRenderer,
    PdfRenderer.of({
      render: (input) =>
        Effect.sync(() => {
          const digest = createHash('sha256').update(JSON.stringify(input)).digest('hex').toUpperCase()
          const crockford = digest
            .replace(/[^0-9A-HJKMNP-TV-Z]/g, '')
            .padEnd(24, '0')
            .slice(0, 24)
          return `fle_01${crockford}` as Id<'file'>
        }),
    }),
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

/** 문서 컨텍스트가 내는 도메인 이벤트입니다. */
export type DocumentEvent =
  | { type: 'esign_request.sent'; companyId: Id<'company'>; requestId: Id<'esignRequest'>; at: string }
  | {
      type: 'esign_request.completed'
      companyId: Id<'company'>
      requestId: Id<'esignRequest'>
      employeeId?: Id<'employee'>
      documentKinds: ReadonlyArray<string>
      resultFileId: Id<'file'>
      at: string
    }
  | { type: 'certificate.issued'; companyId: Id<'company'>; issuanceId: Id<'certificateIssuance'>; at: string }

/** 도메인 이벤트를 내보내는 포트입니다. 아웃박스가 생기면 그 구현을 넣습니다. */
export class DocumentEvents extends Context.Service<
  DocumentEvents,
  { publish(event: DocumentEvent): Effect.Effect<void>; published(): Effect.Effect<ReadonlyArray<DocumentEvent>> }
>()('semu/documents/DocumentEvents') {
  /** 낸 이벤트를 메모리에 쌓습니다. */
  static readonly layerMemory = Layer.effect(
    DocumentEvents,
    Effect.map(Ref.make<ReadonlyArray<DocumentEvent>>([]), (store) =>
      DocumentEvents.of({
        publish: (event) => Ref.update(store, (events) => [...events, event]),
        published: () => Ref.get(store),
      }),
    ),
  )
}
