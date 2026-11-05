# 진입 가드 순서와 회사 선택

## 요약

- 모든 화면 이동마다 클라이언트 가드 여섯 개가 정해진 순서로 돌고, 첫 번째로 걸린 가드가 리다이렉트 대상을 정합니다
- 순서: 로그인 → 가입 약관 → 세무 약관 → 회사 보유 → 메뉴 접근(또는 프로모션) → 시스템 관리자
- 앱 초기화는 nexus `GET /api/user/me/`와 sf `GET /api/member/profile/`의 이메일이 다르면 로그아웃합니다
- 회사 선택 우선순위: 쿼리 `_company_id`(sf ID) → 쿼리 `_nexus_company_id` → 쿠키 `SELECTED_COMPANY_ID` → `companies` 마지막 항목

## 현행 위치

- 가드: 번들 B:104680-104830 (`requireAuthGuard`, `checkHasRequiredConsent`, `checkHasTaxRequiredConsent`, `checkHasCompanyGuard`, `checkPermissionGuard`, `checkSystemAdminGuard`)
- 초기화: `initializeUser` B:105086-105140, 쿼리 제거 B:77945-77947

## 로직

| 순서 | 가드 | 조건 | 이동 |
|---|---|---|---|
| 1 | `requireAuthGuard` | 비공개 라우트 + 비로그인 | `/login?next=` |
| 2 | `checkHasRequiredConsent` | `signup` 약관 중 `needsConsent` | `/agree-terms?next=` |
| 3 | `checkHasTaxRequiredConsent` | 세무 회사가 있고 `tax` 약관 중 `needsConsent` | `/tax-agree-terms` |
| 4 | `checkHasCompanyGuard` | `companies` 비어 있음(`companyNotRequired` 라우트 제외) | 초대 있으면 `/no-company`, 없으면 `/register-company?showToast=true` |
| 5 | `checkPermissionGuard` | `meta.requiresMenuAccess` 라우트가 메뉴 트리 3뎁스에 없음 | `/dashboard`, 프로모션 노드면 `promotionUrl` |
| 6 | `checkSystemAdminGuard` | `meta.requiresSystemAdmin`(현재 `/ai-agent`) + `!isSystemAdmin` | `/dashboard` |

초기화는 회사를 고른 뒤 `localStorage.JWT`를 지우고 회사 JWT를 다시 받고, 회사 상세·권한·구독을 병렬로 읽습니다. 첫 진입 시 `_nexus_company_id`, `_company_id`, `aff` 쿼리를 지웁니다.

## 근거

`docs/reference/spec/platform.md:31-39`

> 1. `requireAuthGuard`: 비공개 라우트 + 비로그인 → `/login?next=`.
> 2. `checkHasRequiredConsent`: `GET /api/user/me/term-agreements/?purpose=signup` → 항목마다 `needsConsent` 판정 → 하나라도 필요하면 `/agree-terms?next=`.
> 3. `checkHasTaxRequiredConsent`: `user.companies.some(c => c.taxPlan === 'taxation')`일 때만 `purpose=tax`로 같은 판정 → `/tax-agree-terms`.
> 4. `checkHasCompanyGuard`: `user.companies`가 비었으면 sf `GET /api/member/active_invitations/`의 `results.length > 0` ? `/no-company` : `/register-company?showToast=true`.
> 5. `checkPermissionGuard`: `meta.requiresMenuAccess` 라우트를 메뉴 트리 3뎁스와 매칭 → 없으면 `/dashboard`, 프로모션이면 `promotionUrl`.
> 6. `checkSystemAdminGuard`: `meta.requiresSystemAdmin`(현재 `/ai-agent`만) + `!isSystemAdmin` → `/dashboard`.
> 7. 첫 진입 시 `_nexus_company_id`, `_company_id`(sf), `aff` 쿼리 제거(B:77945-77947).
>
> 초기화(`initializeUser`, B:105086-105140): `nexus GET /api/user/me/` + `sf GET /api/member/profile/` → **두 email이 다르면 "User Mismatch"로 로그아웃**. 회사 선택 우선순위: 쿼리 `_company_id`(sf id) → 쿼리 `_nexus_company_id` → 쿠키 `SELECTED_COMPANY_ID` → `companies` 마지막 항목. 그 뒤 `localStorage.JWT` 삭제 → JWT 재발급 + 회사 상세/권한/구독 병렬 로드.

## 픽스처

[`apps/api/test/fixtures/rules/entry-guard-order.json`](../../../apps/api/test/fixtures/rules/entry-guard-order.json): 19건 (추적 19)

| 케이스 | 결과 |
|---|---|
| 비로그인 비공개 라우트 | `/login?next=` |
| 가입 약관 대기 + 회사 없음 | `/agree-terms` (회사 가드보다 먼저) |
| 세무 회사 + 세무 약관 대기 | `/tax-agree-terms` |
| 회사 없음, 초대 있음 / 없음 | `/no-company` / `/register-company?showToast=true` |
| 메뉴 없음 / 프로모션 | `/dashboard` / `promotionUrl` |
| `/ai-agent` 비관리자 | `/dashboard` |
| 회사 선택 4단계 | sf 쿼리 → nexus 쿼리 → 쿠키 → 마지막 |
| 이메일 불일치 | 로그아웃 |

## 서버 이전 시 주의

- 가드 1–6은 모두 화면 진입 시점에만 있습니다. 서버는 같은 판정을 엔드포인트마다 강제하고(401·403 `TERMS_REAGREEMENT_REQUIRED`·`PERMISSION_DENIED`·`ENTITLEMENT_REQUIRED`), 클라이언트는 `/me`의 결과로 리다이렉트만 정합니다
- 이메일 불일치 로그아웃은 백엔드가 둘(nexus·sf)이라 생긴 방어 코드입니다. 사용자 저장소가 하나면 필요 없습니다
- 회사 선택은 회사 ID 두 개(nexus·sf)를 쿼리로 받습니다. 재설계는 회사 ID 하나와 `POST /auth/sessions:switch-company`로 바꿉니다
- 쿼리·쿠키의 회사가 사용자 소속이 아닐 때 동작이 보이지 않습니다. 서버는 소속이 아닌 회사로 전환을 403으로 거절합니다
- 회사가 없는 사용자의 분기(초대 대기 vs 회사 등록)는 `/me`에 `pendingInvitations` 건수로 줍니다
