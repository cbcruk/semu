# 플랫폼·연동 도메인 설계

`apps/api/src/modules/platform`이 인증, 가입, 회사·사용자·권한, 약관, 구독·결제, 계약, 상담·리드, 외부 파트너, 기관 연동과 인증서, AI 비서와 지원사업 추천을 맡습니다. 스펙은 `docs/spec-notes/platform.md` §5(128개 엔드포인트)입니다.

## 구성

| 폴더 | 내용 |
| --- | --- |
| `auth/` | scrypt 비밀번호, 세션·CSRF 쿠키, 로그인·카카오·회사 JWT·비밀번호 재설정 |
| `accounts/` | 내 정보, 가입 이메일 인증, 사업자번호 확인, 회사 등록, 데모 계정 |
| `terms/` | 약관 버전, 필수·선택, 재동의 판정, 게스트 동의 |
| `company-profile/` | 회사 상세·설정(nexus + sf 합친 모양), 대표자, 첨부·계약서, 홈택스 수임동의 |
| `company-users/` | 사용자 목록·권한, 권한 그룹, 템플릿, 메뉴 카탈로그, 즐겨찾기 |
| `invitations/` | 내부 초대(30일, 이메일당 활성 1건) |
| `billing/` | 구독, 출금 동의, 청구·결제, 플랜 캐시 동기화 |
| `contracts/` | 기장료 계산, 직접 계약(본인 확인 → SMS → 양식 → 서명), 가입 초대 |
| `leads/`, `external/` | 상담·온라인 리드, 파트너 payload·연결, 오버택스 SSO, 상담 채널 |
| `integrations/` | 기관 연동, 항목, 수집 요청·쿨다운, 인증서, 사업자 상태·회사 정보 공유 |
| `assistant/` | AI 대화와 도구 제안, 지원사업 추천 |
| `adapters/` | 외부 시스템 인터페이스와 결정적 가짜 구현 |

라우터는 세 개입니다. `platform.public-routes.ts`(인증 전), `platform.account-routes.ts`(인증 후, 회사 경로 밖), `platform.company-routes.ts`(`/api/company/:companyId` 아래, `integrationRoutes` 포함).

## 결정

- **인증 두 방식.** `middleware/auth.ts`는 Bearer HS256 JWT와 세션 쿠키를 모두 받습니다. JWT의 `exp`는 hono 기본 검사 대신 주입된 시계로 확인합니다(테스트에서 만료를 재현하려고). 세션 쿠키는 `sessionid`이고 DB에는 SHA-256 해시만 둡니다. 쿠키 인증의 안전하지 않은 메서드는 `X-CSRFToken`/`X-XSRF-TOKEN` 헤더 = CSRF 쿠키 = 세션 CSRF 토큰이어야 합니다(`CSRF_FAILED` 403).
- **세션의 회사.** 세션에는 회사가 없으므로 경로의 `/company/:id`를 토큰 회사로 보고, 실제 판정은 `companyScope`의 멤버십·배정 검사에 맡깁니다.
- **세션 수명.** 기본 1일, `stay_signed_in`이면 14일. 비밀번호를 바꾸면 그 사용자의 세션을 모두 폐기합니다.
- **회사 JWT.** 1시간, `{sub, company_id, sf_company_id, user_type, iat, exp}`. sf와 nexus 회사 ID가 이 구현에서 같으므로 `sf_company_id = company_id`입니다.
- **비밀번호 정책.** 8–20자, 영문과 숫자를 모두 포함. scrypt(N=16384) + 사용자별 솔트.
- **약관 재동의.** 용도별 현재 약관(같은 코드의 최신 `effective_from`)과 마지막 동의 이력을 비교해, 필수 약관의 버전이 바뀌었거나 동의하지 않았으면 `needs_consent`입니다. `tax` 용도의 동의는 접근 판정이 보는 기존 `term_agreements`에도 기록합니다.
- **구독이 진실.** `company_subscriptions`가 원본이고 `companies.tax_plan`/`has_payroll_plan`은 캐시입니다. 모든 변경은 `syncCompanyPlans`를 거쳐 `decide()`와 청구가 어긋나지 않습니다. 구독 변경은 담당자 전용 `PUT /perm/subscription/:code`입니다.
- **메뉴 제외 규칙의 서버 이동(§4.4).** `access/menu-exclusions.ts`에 `MENU_EXCLUSION_RULES`(급여 플랜이면 `employee_management` 제외)와 본사(`agency_type = 'hq'`) 프로모션 코드를 두고 `menu-tree.service.ts`가 씁니다. 기존 메뉴 트리 테스트는 그대로 통과합니다.
- **시스템 관리자 전용 메뉴.** `MenuRule.requiresSystemAdmin`을 추가했고 `decide()`가 `PERMISSION_DENIED`로 거절합니다. `ai_agent`가 첫 사용처입니다. `memberships.is_system_admin`은 회사를 등록한 계정에 켜집니다.
- **자격 증명.** 연동 비밀번호, 인증서 키·비밀번호, CMS 계좌번호, 파트너 JWT 비밀은 `deps.cipher`로 암호화해 저장하고 응답에 넣지 않습니다. 지로 ID·비밀번호는 저장하지 않고 통과만 시킵니다.
- **수집.** 상태는 요청 `request|done|timeout`, 폴링 결과 `PROGRESS|SUCCESS|FAIL`. 사용자 수동 수집 뒤 600초 쿨다운이며 거절은 429 `RATE_LIMITED` + `remain_seconds`입니다. 진행 중 요청은 600초가 지나면 타임아웃으로 보고 새 요청을 받습니다. 결과는 `scrap_results`에 남기고 레코드는 `ScrapResultSink`로 넘깁니다. 기장 테이블은 쓰지 않습니다(기본 싱크는 no-op).
- **AI 비서.** `AssistantAdapter`가 답과 도구 제안을 돌려줍니다. 허용 도구는 메뉴·플랜으로 정하고(`issue_tax_invoice`, `request_certificate`는 세무 플랜, `lookup_payroll`은 급여 플랜), 쓰기 도구는 `requires_confirmation`만 붙이고 실행하지 않습니다.
- **어댑터 주입.** `AppDeps`의 선택 필드이고 `resolvePlatformDeps`가 빠진 것을 가짜로 채웁니다.

## 스펙과 다른 점

- 경로는 끝 슬래시 없이 정의합니다(`strict: false`로 둘 다 받음).
- 응답 키는 snake_case입니다(프론트의 camelCase 변환 전제). 예: `is_system_admin`, `needs_consent`.
- #45·#75·#128(`GET /api/company/:id`)은 하나의 핸들러가 nexus와 sf 필드를 합쳐 돌려줍니다.
- #54(`/menu/menu-tree/:version`)는 기존 `menuTreeRoutes`가 처리합니다. #53(`/user/me/menu-tree/:version`)은 같은 트리에 즐겨찾기 표시를 붙입니다.
- #82·#83 홈택스 수임동의는 경로에 회사가 없어 `company_id`(쿼리/본문) 또는 JWT의 `company_id`로 회사를 정합니다.
- #74 `/nexus-api/company/:id/subscriptions`는 프록시 대신 직접 응답합니다.
- 비밀번호 재설정 토큰을 다시 쓰면 404가 아니라 410 `GONE`입니다.
- 추가 엔드포인트: `PUT /api/company/:id/perm/subscription/:code`(담당자), `POST /api/company/:id/payment/:paymentId/retry`(담당자), `GET /api/settings/company/:id/attachments/download`, `/api/company/:id/ai-agent/{conversations,messages}`, `GET /api/company/:id/grants/recommendations`, `GET /api/company/:id/share-histories/recent`.

## 추정 응답

스펙에 "추정"·"미확인"으로 남은 응답은 아래 모양으로 정했습니다.

| # | 엔드포인트 | 응답 |
| --- | --- | --- |
| 1 | `POST /api/login` | `{user, csrf_token, expires_at}` + 쿠키 |
| 2 | `POST /api/login/social` | `{status, user?, signup_token?, email?}` |
| 14 | `GET /api/pre-signup/check/business_number` | `{business_number, is_valid, is_duplicated, business_status, taxation_type, closed_on}` |
| 15 | `GET /api/pre-signup/check-email-duplicate` | `{is_duplicated}` |
| 17–20 | 가입·회사 등록 | `{user, csrf_token, expires_at}` / 회사 상세 |
| 22 | `company_system_admin_list` | `[{email}]`(마스킹) |
| 23–24 | 파트너 attach / join | `{state: 'INTEGRATED', company_id, user_id?}` |
| 30 | `GET /api/member/demo` | `{email, password}` |
| 32 | 상담 채널 실패 | 422 `{code, detail, fail_reason: 'token is invalid' \| 'token is used' \| 'token is expired'}` |
| 35 | `POST /api/join/signup-invitations` | `{signup_session, email}` |
| 37 | 기장료 계산 | `{contract_id, monthly_fee, adjustment_fee, vat_excluded, breakdown}`(요율표는 자리표시값) |
| 49 | `GET /user/invitation?email=` | `{email, is_existing_user, is_member, has_pending_invitation, can_invite}` |
| 50 | 권한 부여 | 본문 `{is_admin, role_ids[]}`, 응답 사용자 상세 |
| 52 | `permission-check` | `{function, action, has_permission}` |
| 55 | `GET /user/me/menus` | `{accessible_permissions: MenuCode[], menus: [{id, code, name, to}]}` |
| 56 | `GET /menus` | `[{id, code, name, to, is_available, promotion_url}]` |
| 60 | 초대 생성 | `{id, email, is_admin, roles[], status, invited_at, expires_at, remaining_days}` |
| 62 | 초대 조회 | `{company_id, company_name, email, inviter_name, is_admin, is_existing_user, status, expires_at}` |
| 64 | `GET /api/perm/menus` | `[{id, name, children: [{id, name, code, to, is_accessible?}]}]`; `?company_id=`를 주면 `is_accessible`을 붙입니다 |
| 71·74 | 구독 | `[{code, name, is_subscribed, status, started_on, ended_on, monthly_fee}]` |
| 78 | 첨부 조회 | `{name, file: {id, file_name, mime_type, size_bytes, uploaded_at} \| null, url}` |
| 82–83 | 홈택스 수임동의 | `{id, company_id, agency_name, status: requested\|agreed\|revoked, requested_at, agreed_at}` |
| 86 | 수집 폴링 | `{id, status: PROGRESS\|SUCCESS\|FAIL, ...}` |
| 87 | 전체 수집 | `{id(group), requests[]}` |
| 124 | 사업자 상태 | `{business_number, business_status, taxation_type, closed_on}` |

## 메뉴

플랫폼이 등록한 메뉴 코드(`platform.menus.ts`)입니다. 기본 메뉴 트리(`default-menu-tree.ts`)에는 아직 없어서, 리드가 아래 잎을 추가해야 권한 카탈로그·즐겨찾기·회사 메뉴 목록에 나타납니다. 플랫폼 에이전트는 그 파일을 수정하지 않았습니다.

| 코드 | 경로 | 권한 필요 | 플랜 | 비고 |
| --- | --- | --- | --- | --- |
| `integrate_transaction` | `/integrate/transaction` | 예 | – | 은행·카드·PG·배달 연동 |
| `integrate_tax` | `/integrate/tax` | 예 | – | 홈택스·여신협회·지로 |
| `cert_management` | `/manage/cert` | 예 | – | 인증서 |
| `external_services` | `/integrate/external` | 예 | – | 외부 서비스 |
| `company_management` | `/settings/company` | 예 | – | 회사 정보 수정 |
| `user_management` | `/settings/user` | 예 | – | 사용자·초대·권한 그룹(관리자 역할도 필요) |
| `service_payment` | `/settings/plan` | 예 | – | 구독·결제 내역 |
| `contract_consent` | `/settings/contract` | 예 | taxation | 계약·동의서 |
| `grant_recommendation` | `/recommend/grant` | 아니오 | – | 지원사업 추천 |
| `ai_agent` | `/ai-agent` | 아니오 | – | 시스템 관리자 전용 |

## 공유 파일 변경

- `app.types.ts`: `AppDeps`에 선택 어댑터 7개(`scraping`, `scrapResultSink`, `messenger`, `billing`, `socialLogin`, `businessStatus`, `assistant`), `AppVariables.sessionId` 추가.
- `middleware/auth.ts`: 세션 쿠키 + CSRF, `resolveCredentials` 공개.
- `modules/access/*`: `requiresSystemAdmin`, `isSystemAdmin`, `agencyType`, `menu-exclusions.ts`.
- 허용 목록 밖: `lib/domain-error*.ts`(코드 `CONFLICT` 409, `GONE` 410, `RATE_LIMITED` 429, `CSRF_FAILED` 403, `INVALID_CREDENTIALS` 401, `CERT_NOT_ALLOWED_FOR_SERVICE` 422와 `remain_seconds`·`fail_reason` 추가), `modules/menu-tree/menu-tree.service.ts`(제외 규칙 사용).
- `test/helpers/test-app.ts`: `createPlatformTestContext`(가변 시계, 메일·SMS 수신함, 쿠키 세션 에이전트) 추가.

## 다른 도메인과 겹치는 부분

기장 스펙도 `partner/scrap/business-status`, `partner/share-company/send`, `share-histories/recent`, 업종 조회·갱신을 나열합니다(그쪽 #31–35). 플랫폼이 `integrations.routes.ts`에서 구현했고 응답 모양은 기장 쪽 추정에 맞췄습니다. 병합할 때 한쪽만 남겨야 합니다.

## 열린 질문

- 기장료 요율표(`contracts.utils.ts`)는 자리표시값입니다. 실제 요율이 필요합니다.
- 카카오 외 소셜 공급자, 오버택스 SSO 토큰의 실제 클레임 이름(`email` 가정).
- 파트너 payload의 사업자번호 클레임 이름(`business_number` 가정).
- 홈택스 수임동의를 누가 만드는지(담당자 데스크 API가 필요). 지금은 시드로만 생깁니다.
- 수집 큐, 구독 갱신, 월 청구 작업을 스케줄러(`jobs/`)에 연결하는 일.
- 인증서 OID 표는 일부만 넣었습니다. 전체 목록 확인이 필요합니다.
- 세션 쿠키의 `Secure` 속성 때문에 로컬 HTTP 개발에서는 브라우저가 쿠키를 보내지 않을 수 있습니다.
