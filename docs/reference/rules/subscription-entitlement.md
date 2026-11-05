# 구독과 플랜 판정

## 요약

- 클라이언트는 구독 목록 `[{code, isSubscribed}]`에서 플래그 셋을 만듭니다: `hasTaxPlan`, `hasPayrollPlan`, `isFree`
- `isFree`는 "구독한 항목이 하나도 없음"입니다. 빈 목록도 무료입니다
- 세무 약관 게이트는 구독 목록이 아니라 `me.companies[].taxPlan === 'taxation'`을 따로 봅니다
- 레거시 서버는 구독 행의 상태와 기간으로 `isSubscribed`를 계산하고(`active`·`cancelled`이면서 시작일 ≤ 오늘 ≤ 종료일), 같은 값으로 회사의 플랜 캐시(`tax_plan`, `has_payroll_plan`)를 갱신했습니다

## 현행 위치

- 번들: 구독 스토어 B:72522-72545
- 호출: nexus `GET /api/company/:cid/perm/subscription/`, sf 프록시 `GET /nexus-api/company/:cid/subscriptions/`
- 레거시 구현: `apps/api/legacy/src/modules/platform/billing/billing.utils.ts`(`isSubscribedOn`, `serializeSubscriptions`), `billing.service.ts`(`syncCompanyPlans`, `refreshSubscriptions`)

## 로직

클라이언트:

```
hasTaxPlan     = some(code === 'tax' && isSubscribed)
hasPayrollPlan = some(code === 'payroll' && isSubscribed)
isFree         = every(!isSubscribed)
```

레거시 서버:

- `isSubscribedOn(row, today) = (status ∈ {active, cancelled}) && startedOn ≤ today && (endedOn == null || today ≤ endedOn)`
- 상태: `pending → active → cancelled(해지 예약) → ended`. 매일 작업이 시작일이 된 `pending`을 `active`로, 종료일이 지난 `active`·`cancelled`를 `ended`로 바꿉니다
- 플랜 캐시: 세무 구독이면 `taxPlan = 'taxation'`, 아니면 `null`. 급여 구독이면 `hasPayrollPlan = true`

## 근거

`docs/reference/spec/platform.md:219-223`

> - nexus `GET /api/company/:id/perm/subscription/` == sf `GET /nexus-api/company/:id/subscriptions/` → 배열 `[{ code: 'tax' | 'payroll' | …, isSubscribed: bool, … }]`(확인, B:72522-72545).
>   - `hasTaxPlan = some(code==='tax' && isSubscribed)`, `hasPayrollPlan = some(code==='payroll' && isSubscribed)`, `isFree = every(!isSubscribed)`.
> - me.companies[].taxPlan === `'taxation'`은 세무 약관 게이트용으로 따로 쓰임 → `subscriptions.tax`와 일관되게 파생(제안: 서버가 같은 소스에서 계산).
> - 서비스 카드 매핑: `free`(무료 재무, 항상), `tax`(세무 아웃소싱), `payroll`(급여 아웃소싱).

`docs/reference/spec/platform.md:81`

> - 서비스 카드 3개: `무료 재무 프로그램`(모든 고객 이용중), `세무 아웃소싱`(혜움 기장 수임 고객), `급여 아웃소싱`(주식회사 혜움 급여 계약 고객).

`apps/api/legacy/src/modules/platform/billing/billing.utils.ts:12-15`

```ts
export function isSubscribedOn(row: SubscriptionRow, today: string): boolean {
  return (row.status === 'active' || row.status === 'cancelled') && row.started_on <= today && (row.ended_on === null || today <= row.ended_on)
}
```

## 픽스처

[`apps/api/test/fixtures/rules/subscription-entitlement.json`](../../../apps/api/test/fixtures/rules/subscription-entitlement.json): 15건 (추적 15)

| 케이스 | 결과 |
|---|---|
| 빈 목록 / 모두 미구독 | `isFree: true` |
| 세무 / 급여 / 둘 다 | 해당 플래그 |
| 모르는 코드 구독 | 플랜 없음, `isFree: false` |
| `active` 시작 전 / `pending` | 미구독 |
| `cancelled` 종료일 당일 / 다음 날 | 구독 / 미구독 |
| `ended` | 미구독 |
| 매일 갱신 | `pending → active`, 종료일 지난 `cancelled → ended` |

## 서버 이전 시 주의

- 플랜의 진실은 Billing의 구독 하나로 두고, Identity & Access는 그 결과(`plans`)만 받습니다. 레거시처럼 캐시 컬럼을 따로 두면 갱신 누락으로 어긋납니다
- `taxPlan`과 `tax` 구독이 따로 내려오는 구조를 없애고 `/me`의 `plans: ["TAXATION", "PAYROLL"]` 하나로 줍니다
- `isFree`의 정의(유료 구독 없음)를 서버가 정하고 `/me`에 넣으면 프로모션 판정이 클라이언트에서 갈리지 않습니다
- 해지 예약(`cancelled`) 중에도 종료일까지 플랜을 유지합니다. 날짜 경계는 회사 시간대(Asia/Seoul) 기준입니다
