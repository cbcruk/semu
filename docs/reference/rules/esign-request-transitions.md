# 전자서명 요청 상태 전이

## 요약

- 초안만 수정·발송하고, 발송 뒤에는 수정·삭제할 수 없습니다(R25)
- 서명 대기·진행 중에는 취소, 완료 뒤에는 무효만 됩니다
- 취소·만료·발송 실패는 초안으로 되돌리거나 지울 수 있습니다

## 현행 위치

- `apps/api/legacy/src/modules/hr/e-sign/e-sign-requests.service.ts:60-80, 140-245`
- `apps/api/legacy/src/modules/hr/e-sign/e-sign-signer.service.ts:67-97`
- `alfred-manual/04-인사/03-전자서명.md:56`
- `docs/reference/spec/hr.md:583-614, 658-659`
- `e-sign-requests.service.ts`의 `DELETABLE`, 발송·취소·무효·되돌리기
- `e-sign-signer.service.ts`의 첫 본인확인(`pending → in_progress`)
- 매뉴얼 전자서명
- 스펙 §3.4, R24–R25

## 로직

- `draft → pending | send_failed` (메일 발송 결과)
- `pending | in_progress → cancelled`, `completed → voided`
- `cancelled | expired | send_failed → draft`, 삭제는 `draft | expired | cancelled | send_failed`
- `pending | in_progress → expired` (기한 다음날)

## 근거

`apps/api/legacy/src/modules/hr/e-sign/e-sign-requests.service.ts:200-237`

```ts
/** Cancels a request the worker has not finished signing: `pending | in_progress → cancelled`. */
export function cancelESignRequest(context: HrContext, companyId: string, requestId: number, userId: string, expectedVersion: number): ESignRequestAggregate {
  return applyTransition(context, companyId, requestId, ['pending', 'in_progress'], 'cancelled', userId, expectedVersion, (now) => ({ cancelled_at: now }))
}

/** Voids a completed contract: `completed → voided`. */
export function voidESignRequest(context: HrContext, companyId: string, requestId: number, userId: string, expectedVersion: number): ESignRequestAggregate {
  return applyTransition(context, companyId, requestId, ['completed'], 'voided', userId, expectedVersion, (now) => ({ voided_at: now }))
}

/** Returns a cancelled, expired or failed request to draft so it can be edited and sent again (재발송). */
export function revertESignRequestToDraft(context: HrContext, companyId: string, requestId: number, userId: string, expectedVersion: number): ESignRequestAggregate {
  const aggregate = applyTransition(context, companyId, requestId, ['cancelled', 'expired', 'send_failed'], 'draft', userId, expectedVersion, () => ({
    token_hash: null,
    due_date: null,
    sent_at: null,
    verified_at: null,
    expired_at: null,
    cancelled_at: null,
    send_error: null,
    verify_failures: 0,
    company_seal_file_id: null,
  }))
  context.deps.db.prepare('DELETE FROM esign_signer_seals WHERE request_id = ?').run(requestId)
  return aggregate
}

/**
 * Deletes a request that is not in progress.
 *
 * @throws {DomainError} `INVALID_TRANSITION` for pending, in-progress, completed and voided requests (rule R25).
 */
export function deleteESignRequest(context: HrContext, companyId: string, requestId: number): void {
  const { db } = context.deps
  transaction(db, () => {
    const request = findRequest(db, companyId, requestId)
    if (request === undefined) throw notFound('E-sign request')
    if (!deleteRequest(db, companyId, requestId, DELETABLE)) throw invalidState('e-sign request', request.status)
```

`alfred-manual/04-인사/03-전자서명.md:56-56`

```md
- 전자 서명을 발송하고 난 후에는 상태에 따라 서명 요청을 취소하거나, 문서를 삭제 또는 수정할 수 있습니다. 서명이 진행중이거나 서명이 완료된 문서는 수정 또는 삭제가 불가하니 참고해 주세요.
```

## 서버 이전 시 주의

- 상태 값을 대문자로 바꿉니다(`CANCELED` 철자 포함)
- 재설계는 `:resend`로 닫힌 요청을 바로 다시 보냅니다(결정 1)

## 열린 질문

1. 현행은 다시 보내려면 초안으로 되돌린 뒤 발송합니다. 취소·만료·발송 실패에서 바로 재발송(:resend)을 열까요
2. 완료 문서의 무효(void)만 있고 되살리기는 없습니다. 무효 후 새 요청을 만들면 될까요
3. 만료는 기한 다음날 00:00(회사 시간대)인데 현행은 조회·배치 때 처리합니다. 스케줄러로 옮길까요

## 픽스처

[`apps/api/test/fixtures/rules/esign-request-transitions.json`](../../../apps/api/test/fixtures/rules/esign-request-transitions.json): 17건 (모두 추적)

| 케이스 | 결과 |
|---|---|
| draft update | `"DRAFT"` |
| draft send | `"PENDING"` |
| draft send rejected by mail | `"SEND_FAILED"` |
| pending update refused | `"ESIGN_REQUEST_TRANSITION_INVALID"` |
| pending delete refused | `"ESIGN_REQUEST_TRANSITION_INVALID"` |
| pending cancel | `"CANCELED"` |
| in progress cancel | `"CANCELED"` |
| first verification starts signing | `"IN_PROGRESS"` |
| complete | `"COMPLETED"` |
| completed void | `"VOIDED"` |
| completed cancel refused | `"ESIGN_REQUEST_TRANSITION_INVALID"` |
| pending expires | `"EXPIRED"` |
| canceled revert to draft | `"DRAFT"` |
| expired delete | `"DELETED"` |
| voided delete refused | `"ESIGN_REQUEST_TRANSITION_INVALID"` |
| expired resend | `"ESIGN_REQUEST_TRANSITION_INVALID"` |
| send failed resend | `"ESIGN_REQUEST_TRANSITION_INVALID"` |
