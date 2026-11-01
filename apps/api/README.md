# @semu/api

Alfred Business 백엔드 API입니다. 세무, 플랫폼·연동, 인사, 급여, 경리·보고서 도메인을 한 앱에서 제공합니다. Hono와 Node 내장 `node:sqlite`로 만들었습니다. 공통 설계는 [`docs/api-architecture.md`](../../docs/api-architecture.md), 세무 설계는 [`docs/tax-api-design.md`](../../docs/tax-api-design.md)에 있습니다.

## 요구 사항

- Node 26 이상 (`node:sqlite`)
- pnpm

## 실행

```sh
pnpm install
export JWT_SECRET=$(openssl rand -hex 32)
export ENCRYPTION_KEY=$(openssl rand -base64 32)

pnpm seed       # data/api.sqlite 생성, 데모 데이터와 신고 건 예약, 테스트용 JWT 출력
pnpm dev        # http://localhost:8787 (watch)
pnpm start
pnpm schedule   # 신고 건 예약 배치 (멱등)
```

```sh
curl -H "Authorization: Bearer <admin token>" localhost:8787/api/company/c-corp/tax/surtax/
```

## 환경 변수

| 이름 | 기본값 | 설명 |
| --- | --- | --- |
| `JWT_SECRET` | (필수) | HS256 서명 키, 32자 이상 |
| `ENCRYPTION_KEY` | (필수) | 주민등록번호·자격 증명 암호화 키(AES-256-GCM, base64 32바이트) |
| `PORT` | `8787` | |
| `DATABASE_PATH` | `./data/api.sqlite` | |
| `STORAGE_DIR` | `./storage` | 업로드 파일 저장 위치 |
| `TAX_TERMS_VERSION` | `2026-01` | 세무 약관 동의 확인 버전 |
| `MAX_UPLOAD_BYTES` | `20971520` | 업로드 크기 상한 |

## 검증

```sh
pnpm typecheck
pnpm test
```

테스트는 `:memory:` DB와 고정 시계(`2026-11-01T09:00:00+09:00`)를 씁니다.

## 데모 계정

| ID | 설명 |
| --- | --- |
| `u-admin` | `c-corp`(법인, 세무 플랜) 관리자 |
| `u-tax` | `c-corp` 세무 권한 멤버 |
| `u-member` | `c-corp` 권한 없는 멤버 |
| `u-ind` | `c-ind`(개인) 관리자, 세무 약관 미동의 |
| `u-free` | `c-free`(무료) 관리자 |
| `u-demo` | 데모 계정(쓰기 차단) |
| `u-manager`, `u-agent` | 세무 담당 팀장과 담당자(`c-corp` 배정) |
| `u-other` | `c-ind`에만 배정된 담당자 |

JWT 페이로드는 `{ sub, company_id? }`입니다. 고객 API는 `company_id`가 경로의 회사와 같아야 하고, 담당자 API(`/api/desk`)는 `company_id` 없이 씁니다.

## 급여

설계는 [`docs/design/payroll.md`](../../docs/design/payroll.md)에 있습니다.

- 계산 엔진(`src/modules/payroll/engine`)은 DB를 쓰지 않는 순수 함수입니다. 진입점은 `calculatePayrollRow(input, rates)`이고, 요율은 `payroll_rate_tables`의 연·월별 기준표에서 옵니다. 앱을 시작할 때 내장 기준표(2026-01, 2026-07)를 없는 것만 넣습니다.
- 기준표의 값마다 확인 여부(`verification`)가 있습니다. 미확인 값(장기요양 요율, 간이세액 산식 계수 등)이 있으므로 **근로소득세는 공식 간이세액표를 넣기 전까지 추정치**입니다.
- 급여 설정은 `/api/company/:id/employment/settings/*`이고 급여 구독(`has_payroll_plan`)이 필요합니다. 회사의 첫 요청 때 기본 설정을 만듭니다.
- 참조 코드, `/api/tax-rates/*`, 급여계산기(`POST /api/payroll/calculator/simulate`)는 회사 경로가 아닌 인증 경로입니다.

```sh
curl -X POST -H "Authorization: Bearer <token>" -H 'Content-Type: application/json' \
  -d '{"type":"wage","monthly_pay":3000000,"meal_allowance":200000}' \
  localhost:8787/api/payroll/calculator/simulate
```

## 경리·보고서

경리(증빙, 입출금, 거래처, 세금계산서 발급, 지로 납부)와 실시간·세무 보고서 API입니다. 결정과 추정은 [`docs/design/bookkeeping.md`](../../docs/design/bookkeeping.md)에 있습니다.

- 고객 API는 `/api/company/:companyId` 아래에 있습니다. 예: `/evidence/:side`, `/bank/transactions`, `/classification-rules`, `/partners`, `/reports/profit-loss/status`, `/report/profit-loss/:year`.
- 결산 업로드는 담당자 API `PUT /api/desk/companies/:companyId/settlements/:year/:scope`입니다.
- 스크래퍼가 모은 데이터는 `ingestScrapedRecords(db, companyId, records, { now, cipher })`로 넣습니다. 같은 `external_key`는 한 행으로 갱신하고, 새 행은 분류 규칙으로 바로 분류합니다.
- 외부 연동(홈택스 발급, 지로 납부, 사업자 상태 조회)은 `AppDeps`의 `hometaxInvoice`, `giroPayment`, `businessStatus` 어댑터로 바꿀 수 있습니다. 비우면 결정적인 가짜 구현을 씁니다.
- 데모 시드는 `c-corp`의 2026년 10월에 거래처 3곳, 계좌 3개, 입출금 8건, 분류 규칙 5개를 넣습니다. 이때 10월 실시간 순이익은 23,030,000원입니다.

## 인사(HR)

설계와 추정 응답은 [`docs/design/hr.md`](../../docs/design/hr.md)에 있습니다.

- 구성원 정보, 전자서명, 제증명은 급여 플랜 메뉴입니다. 데모 `c-corp`는 급여 플랜이 꺼져 있어 403이 납니다. 로컬에서 쓰려면 `UPDATE companies SET has_payroll_plan = 1 WHERE id = 'c-corp'`를 실행하세요.
- 시드 직원: 김민준(정규직), 이서연(육아휴직), 박지훈(퇴사), 최유진(기간제, 20일 뒤 만료).
- 상태가 바뀌는 쓰기(휴직, 퇴사일, 전자서명 발송·취소, 증명서)는 `If-Match`가 필요합니다. 직원 상세 응답의 `ETag`를 그대로 보내면 됩니다.
- 근로자 서명 링크(`/api/employment/e-sign/:token/*`)와 증명서 링크(`/api/employment/certificates/:token/*`)는 JWT 없이 동작합니다. 본인 확인 뒤 받은 세션을 `X-ESign-Session`(증명서는 `X-Certificate-Session`) 헤더로 보냅니다.
- 알림, PDF 렌더링, 본인 확인은 `AppDeps`의 `notifier`, `pdfRenderer`, `identityVerifier`로 바꿀 수 있습니다. 넘기지 않으면 가짜 구현을 씁니다.

## 플랫폼(인증·가입·연동)

- **인증.** `Authorization: Bearer <HS256 JWT>` 또는 세션 쿠키(`sessionid`) 둘 다 받습니다. 쿠키로 인증한 `GET`·`HEAD`·`OPTIONS` 외 요청은 `X-CSRFToken`(또는 `X-XSRF-TOKEN`) 헤더가 `csrftoken`/`nexus_csrftoken` 쿠키, 세션의 CSRF 토큰과 모두 같아야 합니다.
- **로그인.** 시드 사용자는 모두 `<ID>@example.com` / `alfred1234`로 로그인합니다. 데모 계정은 `GET /api/member/demo/`가 돌려주는 `u-demo@example.com` / `demo1234`입니다.
- **회사 JWT.** `POST /api/user/me/jwt/ {company_id}`가 `{sub, company_id, sf_company_id, user_type, iat, exp}`(1시간) 토큰을 발급합니다. 회사 멤버와 배정된 담당자만 받을 수 있습니다.
- **어댑터.** 스크래핑, 메일·SMS, CMS 출금, 카카오 로그인, 사업자 상태 조회, AI 비서는 `AppDeps`의 선택 필드이고, 비우면 결정적인 가짜 구현이 쓰입니다. 가짜 스크래핑은 `wrong`으로 시작하는 비밀번호를 거절합니다.
- **시드 픽스처.** 가입 초대 토큰 `signup-invite-demo`, 상담 채널 토큰 `chat-channel-demo`, 파트너 `partner-demo`(API 키 `partner-demo-key`), 홈택스 수임동의 `htd-corp`가 있습니다. 값은 `PLATFORM_SEED`(`src/modules/platform/platform.seed.ts`)에 모여 있습니다.
- **작업.** 수집 큐는 `processScrapQueue`, 구독 상태 갱신은 `refreshSubscriptions`, 월 청구는 `runBillingCycle`(`modules/platform`)입니다. 스케줄러에는 아직 연결하지 않았습니다.
