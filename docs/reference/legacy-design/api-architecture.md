# semu API 아키텍처

> 상태: v0.2 · 2026-11-01 · 구현: [`apps/api`](../apps/api/README.md)
>
> 도메인별 근거는 `docs/spec-notes/*.md`, 세무 도메인 설계는 [`tax-api-design.md`](tax-api-design.md)에 있습니다.

이 문서는 세무 API(`apps/api`)를 semu 전체 백엔드로 넓히면서 모든 도메인이 공유하는 결정을 정합니다. 도메인별 세부 설계는 `docs/design/<domain>.md`에 둡니다.

## 1. 하나의 앱, 세 백엔드의 경로

현행 클라이언트는 백엔드 세 곳을 부릅니다(`spec-notes/platform.md` 0절).

| 현행 | 인증 | 대표 경로 |
| --- | --- | --- |
| nexus-api | 세션 쿠키 + CSRF | `/api/login/`, `/api/user/me/`, `/api/perm/*`, `/api/company/:id/user/` |
| sf-api | 세션 쿠키 + CSRF | `/api/company/:id/employment/*`, `/payroll/*`, `/report/*`, `/tax/surtax/` |
| remittance-api | `Authorization: Bearer <회사 JWT>` | `/api/company/:id/integrations/*`, `/giros/*`, `/transaction-sales/*`, `/partner/*` |

새 API는 이 경로를 **한 앱에서 그대로** 받습니다. 클라이언트는 base URL만 바꾸면 됩니다.

- **회사 ID는 하나입니다.** 현행의 nexus 회사 ID와 `sfCompanyId`를 `companies.id` 하나로 합칩니다. 회사 응답의 `sf_company_id`에는 같은 값을 돌려줍니다.
- **경로가 겹치면 응답을 합칩니다.** 예를 들어 nexus와 sf가 모두 `GET /api/company/:id/`를 갖습니다. 이 경우 플랫폼 도메인이 두 응답의 필드를 합친 하나의 응답을 만듭니다.
- **경로는 끝 슬래시 없이 정의합니다.** 앱이 `strict: false`라서 `/foo`와 `/foo/` 요청이 모두 맞습니다. 정의 자체에 슬래시를 붙이면(`'/foo/'`) 매칭이 깨지는 것을 확인했습니다.

## 2. 인증과 행위자

- **두 가지 자격 증명.** Bearer 회사 JWT(기존 구현)와 세션 쿠키(플랫폼 도메인이 추가)를 모두 받습니다. 둘 다 `c.var.user`를 채웁니다. 세션으로 들어온 요청은 `tokenCompanyId`가 없으므로 회사 범위는 소속으로만 판정합니다.
- **행위자.** 회사 경로의 `c.var.access.actor`는 다음 둘 중 하나입니다.
  - `client`: 회사 소속 사용자
  - `agency`: 그 회사에 배정된 세무 담당자(팀장은 팀원 배정 포함)

  담당자는 모든 메뉴를 열 수 있고 고객 약관 게이트를 거치지 않습니다. 급여처럼 담당자 동작이 회사 경로에 있는 도메인은 이 값으로 동작별 권한을 판정합니다.
- **데모 계정**(`user_type 99`)의 쓰기는 회사 범위 미들웨어가 막습니다.
- **공개 경로**(로그인, 가입, 근로자 전자서명 링크)는 도메인의 `public` 라우터로 등록합니다. `public` 라우터는 인증 미들웨어보다 먼저 마운트됩니다.

## 3. 도메인과 소유권

| 도메인 | 폴더 | 마이그레이션 | 소유 테이블(접두어) | 명세 |
| --- | --- | --- | --- | --- |
| 세무(기존) | `modules/{filings,tax-calendar,action-cards,tracker,estimated-vat,menu-tree,access,companies}` | `0001` | 기존 전부 | `tax-api-design.md` |
| 플랫폼·연동 | `modules/platform/**` | `0010-platform.sql` | `users`·`companies`·`memberships`·`perm_roles`·`term_agreements`·`scrap_requests` 확장, `sessions`, `invitations*`, `terms`, `subscriptions`, `payments`, `integrations*`, `certificates`, `contracts`, `consult*`, `menu_favorites` 등 | `spec-notes/platform.md` |
| 인사 | `modules/hr/**` | `0020-hr.sql` | `employees`와 직원 하위 리소스, `departments`, `positions`, `esign_*`, `certificate_*`, `document_forms` | `spec-notes/hr.md` |
| 급여 | `modules/payroll/**` | `0030-payroll*.sql` | `payroll_*`, `work_conditions`, `work_schedule_policies`, `severance_*` | `spec-notes/payroll.md` |
| 경리·보고서 | `modules/bookkeeping/**` | `0040-bookkeeping.sql` | `sales_evidence`·`purchase_evidence` 확장, `account_titles`, `classification_rules`, `bank_*`, `card_*`, `partners`, `transaction_sales*`, `giros*`, `settlement_*` | `spec-notes/bookkeeping.md` |

- **다른 도메인의 테이블은 쓰지 않습니다.** 읽기는 그 도메인이 내보내는 repository 함수로만 합니다. 스키마를 바꾸는 쪽이 읽는 쪽 코드를 깨지 않게 하기 위해서입니다.
- **기존 테이블 확장**은 `ALTER TABLE … ADD COLUMN`으로 소유 도메인의 마이그레이션에서 합니다. 기존 열의 의미는 바꾸지 않습니다.
- **마이그레이션 번호는 위 범위를 씁니다.** 같은 도메인 안에서는 `0031-…`처럼 이어 붙입니다.

## 4. 도메인 간 계약

| 제공 | 사용 | 계약 |
| --- | --- | --- |
| 인사 `employees` | 급여, 전자서명, 증명서 | `modules/hr/employees/employees.repository.ts`의 조회 함수. 직원 종류(`wage-salary`, `daily`, `business`, `other`)는 `employees.kind` 한 열로 구분하고, 와이어의 `employment_type`(`wageemployee` 등)으로 바꾸는 함수를 제공합니다 |
| 인사 직원 하위 리소스(근로계약, 급여계약, 4대보험, 소득세 공제, 가족) | 급여 계산 | 직원 ID로 "계산 시점에 유효한" 값을 돌려주는 조회 함수 |
| 급여 대장 마감 | 세무 원천세 | `payroll_ledger_closed` 항목 자동 연계. 지급월의 대장이 모두 마감되면 `provided`가 됩니다. 원천세가 `filed` 이상이면 해당 지급월 대장의 승인 취소·반려·재계산·추가 카드를 막습니다 |
| 급여 인건비 집계 | 경리 인건비 보고서 | 급여 도메인이 `/report/labor-cost` 계열 엔드포인트를 직접 제공합니다 |
| 플랫폼 구독 | 접근 판정 | `companies.tax_plan`, `companies.has_payroll_plan`을 구독 변경 시 함께 갱신해 `decide()`가 그대로 동작하게 합니다 |
| 플랫폼 연동 수집 | 경리 증빙 | 수집 레코드 형식은 경리의 `ScrapedRecord`입니다(경리가 테이블을 소유하므로). 플랫폼의 `ScrapResultSink` 기본값은 경리의 `createBookkeepingScrapResultSink`이고, 이것이 `ingestScrapedRecords`를 부릅니다. 같은 `external_key`는 한 행으로 갱신됩니다 |
| 경리 사업자 상태·업종 | 플랫폼 지원금 추천 | 사업자 상태조회 어댑터 인터페이스는 플랫폼의 `BusinessStatusAdapter` 하나를 씁니다. 업태·종목은 경리의 `company_business_types`가 원천이고, 플랫폼은 `listBusinessTypes`로 읽습니다 |

## 5. 정기 작업

`src/jobs/run-periodic-jobs.ts`의 `runPeriodicJobs`가 정기 작업을 한 번씩 실행합니다(`pnpm jobs`). 모든 작업이 멱등이라 외부 cron이 몇 분마다 불러도 됩니다. 실행 순서는 다음과 같습니다.

1. 구독 갱신: 플랜이 신고 건 예약을 정하므로 가장 먼저 실행합니다.
2. 월 청구
3. 신고 건 예약
4. 수집 큐 처리
5. 전자서명 기한 만료
6. 고아 파일 정리

## 6. 공통 구현 규약

- **와이어.** JSON은 snake_case이고 목록은 DRF 봉투(`lib/drf-pagination`)를 씁니다. 오류는 `DomainError` → `{detail, code}` 형식입니다(`lib/domain-error`).
- **검증.** zod 스키마를 `<module>.schema.ts`에 두고 `validationHook`으로 검증합니다. 실패하면 422입니다.
- **동시성.** 상태 전이 요청은 `If-Match` + `version`을 씁니다(`middleware/if-match`). 단순 필드 수정은 마지막 쓰기 우선으로 처리합니다.
- **값 타입.** 금액은 원 단위 정수(`lib/money`), 날짜는 `PlainDate`(`lib/plain-date`)입니다. 시각은 주입받은 `Clock`에서만 읽습니다.
- **파일.** `lib/file-storage`와 `files` 테이블을 재사용합니다. 업로드 순서는 `tax-api-design.md` 8절을 따릅니다.
- **민감정보.** 주민등록번호, 계좌번호, 연동 자격 증명은 `lib/crypto`의 `Cipher`(`deps.cipher`)로 암호화해 저장하고, 응답에서는 `lib/masking`으로 가립니다.
- **외부 연동.** 홈택스, 은행, 카드, PG, 메일·알림톡, PDF, 본인확인 같은 외부 연동은 도메인 폴더의 `*.adapter.ts` 인터페이스 뒤에 둡니다. 기본 구현은 결정적인 가짜(fake)이고 `AppDeps`로 주입합니다.
- **메뉴.** 도메인 메뉴 규칙은 `<domain>.menus.ts`에 둡니다. `menu-codes.ts`가 모든 도메인의 규칙을 합칩니다.
- **시드.** 데모 데이터는 `<domain>.seed.ts`에 둡니다. 공용 회사와 사용자(`SEED`) 위에 쌓습니다.
- **파일 규칙.** kebab-case 파일명, `*.types.ts`·`*.utils.ts` 분리, 명시적 반환 타입, 내보내는 심볼의 JSDoc, 인라인·배너 주석 금지(`~/.claude/CLAUDE.md`).

## 7. 응답 형태를 모를 때

엔트리 번들에는 화면 컴포넌트가 없습니다. 그래서 여러 엔드포인트의 응답 형태가 확인되지 않았습니다. 이런 경우의 우선순위는 다음과 같습니다.

1. 데모 목업과 요청 본문에서 확인한 필드
2. 매뉴얼 스크린샷의 열 이름
3. 같은 도메인의 다른 응답과 일관된 형태

추정으로 정한 형태는 `docs/design/<domain>.md`의 "추정 응답" 표에 남깁니다.
