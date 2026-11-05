# 메뉴 노출 판정

## 요약

- 메뉴 노출은 메뉴 코드(3뎁스 잎)마다 **적용 대상 → 권한 → 시스템 관리자 → 플랜 → 세무 약관** 순서로 판정합니다(레거시 `decide()`)
- 관리자는 적용 가능한 전체 메뉴, 일반 사용자는 권한 그룹 메뉴의 **합집합**입니다. 세무 대리인은 전체 메뉴를 보고 약관 게이트를 건너뜁니다
- 플랜만 없는 메뉴는 **무료 회사**에서만 프로모션 노드로 남습니다. `pb_employment`·`pb_payroll_management`는 본사(HQ) 에이전시 회사에도 보입니다
- 급여 구독 회사는 `employee_management`(직원 관리)를 숨깁니다. `ai_agent`는 시스템 관리자만 봅니다
- 세무 약관 미동의는 메뉴를 남기고 데이터만 막습니다. 잎이 모두 빠진 그룹·섹션은 지웁니다

## 현행 위치

- 번들: 메뉴 제외 규칙 `MENU_EXCLUSION_RULES` B:77551(급여 구독 → 직원 관리), B:77553(`/ai-agent`), 프로모션 B:77617-77630
- 레거시 구현: `apps/api/legacy/src/modules/access/access.ts`(`decide`), `access/menu-exclusions.ts`, `menu-tree/menu-tree.service.ts`(`buildMenuTree`), 메뉴 규칙 `access/menu-codes.ts`, `platform/platform.menus.ts`, `hr/hr.menus.ts`, `payroll/payroll.menus.ts`, `bookkeeping/bookkeeping.menus.ts`, 트리 `menu-tree/default-menu-tree.ts`

## 로직

메뉴 규칙 필드: `requiredPlans`(하나라도 있으면 됨), `applicableTo`(`corporate`/`individual`/전체), `requiresPermission`(일반 사용자에게 그룹 부여 필요), `requiresTaxTerms`, `promotionUrl`, `requiresSystemAdmin`.

| 순서 | 판정 | 거절 사유 | 트리에서 |
|---|---|---|---|
| 1 | `applicableTo`가 회사 사업자 형태와 다름 | `NOT_FOUND` | 숨김 |
| 2 | `requiresPermission`인데 관리자가 아니고 그룹에 없음 | `PERMISSION_DENIED` | 숨김 |
| 3 | `requiresSystemAdmin`인데 시스템 관리자가 아님 | `PERMISSION_DENIED` | 숨김 |
| 4 | `requiredPlans` 중 가진 플랜이 없음 | `ENTITLEMENT_REQUIRED` | 무료 회사(또는 HQ + `pb_*`)면 프로모션, 아니면 숨김 |
| 5 | `requiresTaxTerms` + 세무 회사 + 약관 미동의 | `TAX_TERMS_REQUIRED` | 보임(데이터 403) |

판정 전에 제외 규칙이 먼저 적용됩니다(급여 구독이면 `employee_management` 제거). 주요 메뉴 규칙:

| 메뉴 | 플랜 | 권한 필요 | 비고 |
|---|---|---|---|
| `tax_surtax`, `tax_withholding` | taxation | 예 | 세무 약관 게이트 |
| `tax_corporation` / `tax_aggr_income` | taxation | 예 | 법인 / 개인만 |
| `employee_management`, `payroll_management`, `contract_consent`, `report_*` | taxation | 예 | |
| `employment_employee`, `employment_e_sign`, `employment_certificate`, `settings_e_sign`, `payroll_settlement`, `payroll_setting`, `severance_pay_settlement` | payroll | 예 | |
| `bookkeeping_*`, `realtime_*`, `settings_accounting`, `integrate_*`, `cert_management`, `company_management`, `user_management`, `service_payment` | 없음 | 예 | |
| `today`, `grant_recommendation`, `document_form`, `salary_calculator` | 없음 | 아니오 | |
| `ai_agent` | 없음 | 아니오 | 시스템 관리자만 |

`user_management`를 가진 일반 사용자라도 초대·권한 그룹 편집은 관리자만 합니다.

## 근거

`docs/reference/spec/platform.md:409-415`

> 1. 프로모션 노드는 `company.isFree`일 때만 노출. 예외: `pb_employment`, `pb_payroll_management`는 HQ 에이전시 회사(sf `agency.type === 'hq'`)에도 노출(B:77617-77630).
> 2. 구독 `payroll`이면 `employee_management` 숨김(B:77551).
> 3. `/ai-agent`는 `isSystemAdmin`만(B:77553).
> 4. 자식이 모두 빠진 2뎁스·1뎁스 노드는 제거.
>
> 관리자 = 회사에서 적용 가능한 전체 메뉴, 일반 사용자 = 그룹 합집합. `회사 설정 > 사용자 관리`를 가진 일반 사용자라도 **초대·권한 CRUD는 관리자 전용**(매뉴얼 표) → 별도 체크.

`alfred-manual/08-설정/02-사용자-관리.md:74`

> 사용자는 자신에게 할당된 권한 그룹들의 메뉴를 합집합으로 접근할 수 있습니다.

`alfred-manual/09-Alfred-Business-메뉴-구조.md:71-81`

> - **구성원 정보**_`(급여 구독, 급여 구독&세무 기장시 노출)`
> - **직원 관리**_`(세무 기장시 노출)`
> ...
> - **급여 정산**_`(급여 구독, 급여 구독&세무 기장시 노출)`
> - **급여 관리**_`(세무 기장시 노출)`

`apps/api/legacy/src/modules/menu-tree/menu-tree.service.ts:31-40`

```ts
if (node.code !== null) {
  if (excluded.has(node.code)) return null
  const decision = decide(context, node.code)
  if (decision.ok || decision.reason === 'TAX_TERMS_REQUIRED') return toNode(node, [], null)
  if (decision.reason === 'ENTITLEMENT_REQUIRED' && showsPromotion(context, node.code, isFreeCompany)) return toNode(node, [], decision.promotionUrl)
  return null
}
```

## 픽스처

[`apps/api/test/fixtures/rules/menu-visibility.json`](../../../apps/api/test/fixtures/rules/menu-visibility.json): 20건 (추적 20)

| 케이스 | 결과 |
|---|---|
| 무료 회사 관리자의 부가세 | 프로모션 `/settings/plan/detail` |
| 법인의 종합소득세 | 숨김 `NOT_FOUND` |
| 그룹에 없는 일반 사용자 (무료 회사 포함) | 숨김 `PERMISSION_DENIED`, 프로모션 없음 |
| 급여 구독 회사의 직원 관리 | 숨김 (제외 규칙) |
| 유료 회사에 없는 플랜 | 숨김 (프로모션은 무료 회사만) |
| HQ 회사의 `pb_employment` | 프로모션 |
| `ai_agent` | 시스템 관리자만 |
| 세무 약관 미동의 | 메뉴 보임, 데이터 403 |
| 세무 대리인 | 적용 가능한 전체 |
| 잎이 모두 빠진 그룹 | 숨김 |

## 서버 이전 시 주의

- 메뉴는 화면 단위입니다. 재설계는 메뉴 코드를 `resource:action` 권한 묶음으로 바꾸고, 클라이언트가 `/me`의 권한·플랜으로 메뉴를 그립니다. 메뉴 트리 자체는 클라이언트 자산입니다
- 판정 순서가 권한 → 플랜이라 그룹이 없는 일반 사용자는 업셀을 보지 못합니다. 재설계의 `authorize`는 플랜을 먼저 봅니다(업셀 우선)
- `employee_management` 제외는 "급여 구독이면 구 직원 관리 화면 대신 구성원 정보"라는 화면 정책입니다. API 권한과 섞지 말고 클라이언트 메뉴 정책으로 남깁니다
- `ai_agent`의 시스템 관리자 제한과 매뉴얼("구독과 상관없이 모든 사용자가 이용")이 어긋납니다
- HQ 에이전시 프로모션은 회사의 대리인 종류에 의존합니다. `/me`에 `agencyType` 또는 `promotions[]`를 주어야 클라이언트가 같은 결과를 냅니다
