# 서명자 본인확인

## 요약

- 서명자는 이름·생년월일로 본인확인합니다. 5번 틀리면 링크가 잠깁니다(429)
- 틀리면 남은 횟수를 알려 주고, 맞으면 실패 횟수를 0으로 되돌리고 30분 세션을 엽니다
- 닫힌 요청(초안·취소·무효·만료·발송 실패)과 완료된 요청은 본인확인을 받지 않습니다

## 현행 위치

- `apps/api/legacy/src/modules/hr/e-sign/e-sign-signer.service.ts:63-111, 246`
- `apps/api/legacy/src/modules/hr/e-sign/e-sign.utils.ts:6-46`
- `e-sign-signer.service.ts`의 `verifySigner`
- `e-sign.utils.ts`의 상수, `maskName`

## 로직

- `verify_failures ≥ 5` → 잠금
- 불일치 → 실패 + 1, `remaining_attempts = max(0, 5 − failures)`
- 첫 성공이 `pending → in_progress`

## 근거

`apps/api/legacy/src/modules/hr/e-sign/e-sign-signer.service.ts:67-97`

```ts
export async function verifySigner(
  context: HrContext,
  aggregate: ESignRequestAggregate,
  claim: { name: string; birth_date?: string | undefined },
  origin: RequestOrigin,
): Promise<{ session_token: string; expires_at: string }> {
  const { db, clock } = context.deps
  const { request } = aggregate
  assertOpen(request)
  if (request.status === 'completed') throw new HrError('SIGNING_CLOSED', 'This document has already been signed.', { status: request.status })
  if (request.verify_failures >= MAX_VERIFY_FAILURES) throw locked()
  const ok = await context.adapters.identityVerifier.verify({ name: aggregate.recipient.name, birthDate: expectedBirthDate(db, aggregate) }, claim)
  if (!ok) {
    const failures = transaction(db, () => {
      insertRequestEvent(db, request, 'verify_failed', { type: 'signer', id: null }, origin, null, clock.now())
      return recordVerifyFailure(db, request.id)
    })
    throw new HrError('IDENTITY_VERIFICATION_FAILED', 'The name or birth date does not match.', { remaining_attempts: Math.max(0, MAX_VERIFY_FAILURES - failures) })
  }
  const session = createSecret()
  const now = clock.now()
  const expiresAt = toSeoulIso(new Date(Date.parse(now) + SIGNER_SESSION_MINUTES * 60_000))
  transaction(db, () => {
    insertSignerSession(db, request, hashSecret(session), origin, now, expiresAt)
    if (request.status === 'pending') {
      transitionRequest(db, request.company_id, request.id, ['pending'], 'in_progress', null, { verified_at: now, verify_failures: 0 }, now)
    }
    insertRequestEvent(db, request, 'verified', { type: 'signer', id: null }, origin, null, now)
  })
  return { session_token: session, expires_at: expiresAt }
}
```

## 서버 이전 시 주의

- 본인확인 방식은 `SignerIdentityVerifier` 포트로 둡니다

## 열린 질문

1. 잠긴 링크를 관리자가 풀 방법이 없습니다(재발송만 가능). 잠금 해제 커맨드를 둘까요
2. 생년월일을 모르는 수신자(직원이 아님)는 이름만 확인합니다. 본인확인을 휴대폰 인증으로 바꿀까요

## 픽스처

[`apps/api/test/fixtures/rules/esign-identity-verification.json`](../../../apps/api/test/fixtures/rules/esign-identity-verification.json): 8건 (모두 추적)

| 케이스 | 결과 |
|---|---|
| first success | `{"outcome": "VERIFIED", "failures": 0}` |
| success after failures resets | `{"outcome": "VERIFIED", "failures": 0}` |
| first failure | `{"outcome": "FAILED", "failures": 1, "remainingAttempts": 4}` |
| fifth failure | `{"outcome": "FAILED", "failures": 5, "remainingAttempts": 0}` |
| locked after five even if right | `{"outcome": "LOCKED", "failures": 5}` |
| name with spaces matches | `true` |
| birth date mismatch | `false` |
| unknown birth date compares name only | `true` |
