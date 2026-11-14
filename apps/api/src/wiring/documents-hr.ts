import { Effect, Layer } from 'effect'
import { Outbox } from '../shared/persistence/outbox.ts'
import { DocumentEvents, type DocumentEvent } from '../modules/documents/shared/documents-ports.ts'
import { SignedDocumentIntake } from '../modules/hr/hr.public.ts'

type EsignOutcome = Extract<DocumentEvent, { type: 'esign_request.completed' | 'esign_request.voided' }>

/**
 * Documents의 `DocumentEvents` 포트를 outbox 채널 `esign_request->hr`로 HR에 넘기는 구현입니다.
 *
 * - `esign_request.completed`: 완료본을 직원 문서 보관함에 넣고 문서가 확정하는 근로·급여계약에 잇습니다
 * - `esign_request.voided`: 보관함 문서를 무효로 두고 계약에서 풉니다
 *
 * 다른 이벤트(`esign_request.sent`, `certificate.issued`)는 아직 받는 곳이 없어 outbox에 쓰지 않습니다.
 * HR에는 문서 종류·제목·계약 조건과 완료본 파일 ID만 넘기고, 서명자가 입력한 다른 값은 넘기지 않습니다.
 * SQLite에서는 서명 완료 트랜잭션이 커밋된 뒤 HR 반영이 자기 트랜잭션에서 돌고, 실패하면 릴레이가 다시 넘깁니다.
 */
export const DocumentEventsToHr: Layer.Layer<DocumentEvents, never, SignedDocumentIntake | Outbox> = Layer.effect(
  DocumentEvents,
  Effect.gen(function* () {
    const intake = yield* SignedDocumentIntake
    const toHr = yield* (yield* Outbox).channel<EsignOutcome>('esign_request->hr', (event) =>
      event.type === 'esign_request.completed'
        ? intake.completed({
            companyId: event.companyId,
            esignRequestId: event.requestId,
            employeeId: event.employeeId,
            title: event.title,
            fileId: event.resultFileId,
            signedAt: event.at,
            documents: event.documents.map(({ kind, title, terms }) => ({ kind, title, terms })),
          })
        : intake.voided(event.companyId, event.requestId, event.at),
    )
    return DocumentEvents.of({
      publish: (event) =>
        event.type === 'esign_request.completed' || event.type === 'esign_request.voided' ? toHr(event) : Effect.void,
    })
  }),
)
