# 약관 재동의 판정

## 요약

- 클라이언트가 라우트 가드에서 약관마다 `needsConsent`를 계산해 하나라도 참이면 동의 화면으로 보냅니다. 서버는 동의 현황만 주고 판정하지 않습니다
- 필수 약관은 "현재 버전에 동의"해야 통과하고, 선택 약관은 **새 버전이 나올 때마다** 다시 묻습니다(이전에 거절했어도)
- 용도(`purpose`)는 `signup`을 항상, `tax`는 사용자의 회사 중 하나라도 `taxPlan === 'taxation'`일 때만 확인합니다
- 목록이 비면 클라이언트가 예외를 던집니다. 세무 수임하지 않은 무료 고객에게는 세무 대리인 약관을 보여 주지 않습니다

## 현행 위치

- 가드: 번들 `checkHasRequiredConsent`, `checkHasTaxRequiredConsent` (B:104680-104830), 판정식 B:104689-104696
- 호출: nexus `GET /api/user/me/term-agreements/?purpose=`, `PATCH /api/user/me/term-agreements/`, `GET /api/terms/?purpose_code=`
- 레거시 구현: `apps/api/legacy/src/modules/platform/terms/terms.utils.ts`(`needsConsent`), `terms.service.ts`(`recordAgreements`)

## 로직

1. 로그인 후 `signup` 용도 항목을 받아 하나라도 `needsConsent`면 `/agree-terms?next=`로 보냅니다
2. `user.companies.some(c => c.taxPlan === 'taxation')`이면 `tax` 용도로 같은 판정을 하고, 필요하면 `/tax-agree-terms`로 보냅니다
3. `needsConsent`
   - 필수: `!history.isAgreed || version !== history.version`
   - 선택: `version !== history?.version`
4. 동의 저장(레거시 서버): 답이 가리키는 약관이 현재 버전이 아니거나, 필수 약관을 거절하면 400입니다. 마케팅 약관(`marketing`) 답은 사용자 `marketing_agreed`에도 씁니다

## 근거

`docs/reference/spec/platform.md:32-33`

> 2. `checkHasRequiredConsent`: `GET /api/user/me/term-agreements/?purpose=signup` → 항목마다 `needsConsent` 판정 → 하나라도 필요하면 `/agree-terms?next=`.
> 3. `checkHasTaxRequiredConsent`: `user.companies.some(c => c.taxPlan === 'taxation')`일 때만 `purpose=tax`로 같은 판정 → `/tax-agree-terms`.

`docs/reference/spec/platform.md:207` (B:104689-104696)

> 판정: 필수면 `!history.isAgreed || version !== history.version`, 선택이면 `version !== history?.version`(선택 약관도 **새 버전이 나오면 다시 묻는다**). 빈 배열이면 클라이언트가 예외를 던짐 → 서버는 purpose당 최소 1개 약관 보장.

`alfred-manual/10-개인-설정-안내.md:16`

> 세무 수임하지 않으신 알프레드 무료 고객은 세무법인 혜움 약관이 노출되지 않습니다.

`apps/api/legacy/src/modules/platform/terms/terms.utils.ts:9-12`

```ts
export function needsConsent(view: Pick<TermAgreementView, 'is_required' | 'version' | 'history'>): boolean {
  if (view.is_required) return view.history === null || !view.history.is_agreed || view.history.version !== view.version
  return view.history?.version !== view.version
}
```

레거시 서버는 `history === null`을 먼저 확인했습니다. 번들 인용식에는 이 검사가 없습니다.

## 픽스처

[`apps/api/test/fixtures/rules/terms-reagreement.json`](../../../apps/api/test/fixtures/rules/terms-reagreement.json): 20건 (추적 20)

| 케이스 | 입력 | 결과 |
|---|---|---|
| 필수, 이력 없음 | `history: null` | 클라이언트 TypeError, 레거시 서버 `true` |
| 필수, 현재 버전 동의 | | `false` |
| 필수, 옛 버전 동의 / 현재 버전 거절 | | `true` |
| 선택, 현재 버전 거절 | | `false` |
| 선택, 옛 버전 거절·동의 | | `true` |
| 용도 | 세무 회사 하나라도 | `["signup", "tax"]` |
| 가드 | signup 대기 | `/agree-terms?next=` (tax보다 먼저) |
| 가드 | tax만 대기, 무료 고객 | 통과 |
| 가드 | 빈 목록 | 예외 |
| 저장 | 필수 거절 / 옛 `term_id` | 400 `VALIDATION_FAILED` |
| 노출 | 무료 고객 | 세무 대리인 약관 제외 |

## 서버 이전 시 주의

- 판정은 클라이언트 가드에만 있어 API를 직접 부르면 우회됩니다. 서버는 필수 약관 미동의 시 제품 API를 403 `TERMS_REAGREEMENT_REQUIRED`로 막아야 합니다
- 선택 약관 새 버전 때문에 앱 전체를 막는 것은 과합니다. 선택 약관은 "다시 물을 목록"으로만 주는 쪽을 검토합니다
- `tax` 용도가 선택한 회사가 아니라 **아무 회사**의 플랜으로 정해집니다. 토큰 하나 = 회사 하나 구조에서는 현재 회사 기준으로 바꿔야 합니다
- 버전 비교가 문자열 그대로라 표기만 바뀌어도 재동의가 걸립니다. 서버는 정수 `revision`을 씁니다
- 동의 기록은 IP·User-Agent를 함께 남깁니다(레거시 `insertAgreement`)
