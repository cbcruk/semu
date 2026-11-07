# 설계 검토

재설계가 현행 업무를 빠짐없이 덮는지, 무엇을 일부러 바꿨고 그 대가가 무엇인지, 구현 전에 누가 무엇을 정해야 하는지 정리합니다.

## 요약

| 항목 | 판단 |
|---|---|
| 업무 범위 | 현행 세 백엔드(nexus·sf·remittance)가 다루는 업무는 모두 대응 리소스가 있습니다. 세무 대리인 데스크 화면, 엑셀 내보내기, 일부 설정 화면처럼 [구현 상태](#구현-상태)에 적은 항목은 설계만 있습니다 |
| 가장 큰 개선 | 급여대장 마감 → 원천세, 전자서명 완료 → 계약, 수집 → 증빙이 서버 안 연계가 되어 "대장은 마감됐는데 신고 항목은 미제출" 같은 불일치가 구조적으로 사라집니다 |
| 가장 큰 위험 | **현행 클라이언트를 그대로 쓸 수 없습니다.** 경로·키·enum·오류 형식이 모두 바뀌었습니다. 호환 계층([bff.md](bff.md))이 인증·회사 전환·구성원 화면부터 덮기 시작했고, 나머지 화면은 조각마다 더해야 합니다. 그리고 급여 요율·간이세액 다수가 미확인이라 계산 결과가 실제와 다를 수 있습니다 |
| 가장 큰 남은 일 | 현행 클라이언트용 BFF(D2)의 나머지 화면, 실제 외부 연동(현재 가짜), 대리인 큐를 Payroll·Integrations로 늘릴지 |

## 엔드포인트 대응

현행 `method + path`를 컨텍스트 단위로 대응시켰습니다. 행 단위 표는 각 문서의 **현행 엔드포인트 대응** 절에 있습니다.

| 현행 그룹 | 개수(약) | 재설계 | 비고 |
|---|---:|---|---|
| nexus 인증·사용자·권한·회사·약관·초대 (spec platform #1–30, 45–70, 75–77) | 70 | [identity-access.md](identity-access.md) | 세션 쿠키+CSRF와 회사 JWT를 액세스 토큰 + refresh 쿠키 하나로. 권한 확인·메뉴 트리 API(#52–56)는 `/me`로 대체 |
| nexus 구독·결제·계약·상담·파트너 (#26, 71–74, 78, 81 등) | 20 | [billing.md](billing.md) | sf의 nexus 구독 프록시(#74) 폐지 |
| remittance 연동·인증서·수집·상태조회 (#32–33, 82–128) | 50 | [integrations.md](integrations.md) | `/integrations/v2/` → `/integrations`, 수집 폴링 → `Job` |
| AI 비서·지원금 | 8 | [assistant.md](assistant.md) | |
| sf 세무 (`/tax/:taxType/*`) + 세무 대리인 데스크 (`/desk/filings/*`) | 34 | [tax.md](tax.md), [agency-queue.md](agency-queue.md) | 세목별 경로를 `/filings` 하나와 커맨드 14개로. 홈 트래커는 `GET /filings?open=true`. 데스크 목록은 대리인 범위 토큰의 `GET /agency/filings` |
| sf 인사 (`/employment/*`) | 101 | [hr.md](hr.md) | 근로·일용·사업·기타 경로 네 벌을 `Employee.kind` 하나로 |
| sf 전자서명·제증명 + `/nexus-api/document-form` | 40 | [documents.md](documents.md) | `/nexus-api/` 예외 경로 폐지 |
| sf 급여 (`/payroll/*`, `/employment/settings/*`, 급여계산기) (#1–155) | 155 | [payroll.md](payroll.md) | 일반 카드와 BPO 카드, BPO 구간별 입력 경로(#46–98)를 `/payroll-ledgers`와 `/rows` 하나로 |
| remittance·sf 경리·보고서 (`/transaction-sales/*`, `/giros/*`, `/evidence/*`, `/report/*`) | 71 | [bookkeeping.md](bookkeeping.md) | `/api/v2/.../giros/:id/payment` → `:pay`, 인건비 보고서는 Payroll 조회로 |

### 범위 밖으로 둔 것

| 현행 | 이유 |
|---|---|
| 세무 대리인 내부 업무 도구의 화면과 그 전용 API(담당자 배정 관리, 기장 입력) | 번들에 없고 고객 앱 범위가 아님. 대리인이 고객 회사에서 하는 동작은 `actor.kind = AGENCY`로, 담당 회사를 가로지르는 조회는 대리인 범위 토큰의 `/agency/*`로 다룸 |
| 채널톡·고객지원 위젯 | 고객지원 기능 |
| 외부 스크립트용 `window.__CLAIR_GET_JWT` | 보안 결함. 대체 경로 없이 폐지 |
| 리포트 앱(레거시 직원 관리 등록·수정) | 리포트 앱 번들이 없어 근거 없음. 목록·상태만 `legacy-employment-status` 규칙으로 남김 |

## 권한 코드 대응

현행 메뉴 코드는 화면 단위라 권한이 아닙니다. 재설계는 `resource:action` 권한으로 바꾸고, 메뉴는 클라이언트가 `/me`의 권한·플랜으로 그립니다. 전체 대응표는 [identity-access.md](identity-access.md)의 **현행 메뉴 코드 → 권한** 한 곳에 둡니다. 컨텍스트별로 쓰는 권한은 다음과 같습니다.

| 컨텍스트 | 권한 | 플랜 |
|---|---|---|
| Identity & Access | `member:*`, `role:*`, `invitation:*`, `audit-log:read`, `company:read/update` | — |
| Billing | `subscription:read`, `payment:read`, `billing-mandate:*`, `service-contract:*` (대리인 전용: `subscription:manage`, `payment:retry/refund`) | `service-contract`는 TAXATION |
| Integrations | `integration:*`, `certificate:*`, `scrap-request:*`, `hometax-delegation:*`, `business-status:read` | `hometax-delegation`은 TAXATION |
| Tax | `filing:read/update/submit/confirm-ledger/pay`, 대리인 전용 `filing:process`, `action-card:read/complete`, `estimated-vat:read` | TAXATION + 약관 |
| HR | `employee:read/create/update/delete/resign/reveal-rrn/reveal-account`, `organization:read/update` | PAYROLL 또는 TAXATION |
| Documents | `esign-request:*`, `esign-template:read`, `certificate-issuance:*`, `document-form:read` | PAYROLL |
| Payroll | `payroll-setting:*`, `payroll-workflow:update`, `payroll-rate-table:read`, `payroll-calculator:simulate`, `payroll-ledger:*`, `payslip:read/send`, `severance-settlement:*`, `labor-cost-report:read` | PAYROLL (인건비는 PAYROLL 또는 TAXATION) |
| Bookkeeping | `evidence:*`, `account-title:*`, `classification-rule:*`, `bank-account:*`, `bank-transaction:*`, `partner:*`, `sales-transaction:*`, `tax-invoice:read/issue`, `giro:read/update/pay`, `report:read`, `settlement-report:read` | 결산 보고서는 TAXATION |

- 관리자는 `*`를 받습니다. 역할은 권한 묶음 프리셋입니다
- 대리인 전용 권한(`filing:process`, `subscription:manage`, `payment:retry/refund`)은 카탈로그의 `agentOnly` 표시로 정합니다. `*`·`resource:*` 와일드카드가 이 권한을 덮지 않으므로 고객 관리자의 `*`에도 들지 않고, 컨텍스트가 `actor.kind`를 따로 보지 않습니다 ([결정](#결정) D5)
- 배정된 세무 대리인은 `*` 대신 대리인 기본 권한(`AGENT_PERMISSIONS`)을 받습니다. 구성원 관리와 AI 비서는 없습니다 (D5, [identity-access.md](identity-access.md#행위자와-권한-계산))
- 대리인 범위 토큰(`/agency/*`)은 `authorizeAgency`로 회사 범위의 대리인과 같은 권한 표를 보고, 플랜은 거절 대신 담당 회사를 거릅니다

## 일부러 바꾼 것과 그 대가

| 결정 | 얻는 것 | 대가 |
|---|---|---|
| 와이어 형식 전면 변경(camelCase, `/v1`, 커서, RFC 9457) | 형식 일관성, 키 변환 인터셉터·`LEGACY_RAW_KEYS` 제거 | **현행 클라이언트를 그대로 쓸 수 없음.** 이전 호환 구현(`apps/api/legacy/`)이 하던 일을 버림. 별도 앱 BFF(`apps/bff`)가 현행 와이어를 받아 `/v1`로 옮김 (D2, [bff.md](bff.md)) |
| 경로에서 회사 ID 제거, 토큰 하나 = 회사 하나 | 회사 범위 검사가 한 곳(인증)에 모임. nexus·sf 회사 ID 통합 | 회사 전환마다 토큰 재발급. 대리인의 여러 회사 작업 큐는 두 번째 토큰 범위(`AGENCY`)와 읽기 전용 `/agency/*`로 따로 둠 (D3). 큐에서 처리로 넘어갈 때마다 범위를 전환함 |
| 상태 enum + 커맨드 | 전이 규칙이 서버 한 곳에 | 엔드포인트 수가 늘어 보임(신고 커맨드 14개, 급여대장 9개) |
| 직원 상태를 저장하지 않고 날짜로 파생 | 입사·휴직·퇴사 예정이 자동 반영 | 목록 필터가 "오늘" 기준 계산을 매번 함. 저장소에서 인덱스로 거를 수 없음 |
| 세무·급여 기록 삭제 금지, 정정·제외 상태 | 보존 의무 충족, 감사 가능 | 저장 공간 증가. "지웠는데 남아 있음"에 대한 사용자 안내 필요 |
| 원천세가 신고되면 그 달 급여대장 잠금 | 신고 금액과 대장의 불일치 방지 | 신고 후 정정은 수정신고 흐름이 생기기 전까지 막힘 |
| 플랜을 Billing 구독에서 파생 | 플랜 캐시 동기화 제거 | 구독이 바뀌어도 액세스 토큰 만료(10분)까지 이전 플랜으로 동작 (D6) |
| 모듈러 모놀리스 + 포트·어댑터 | 트랜잭션 경계가 단순, 컨텍스트 경계가 코드에 드러남 | 포트마다 어댑터를 `wiring/`에 유지해야 함. 제공 쪽 데이터가 부족한 포트는 기본값으로 채움(예: Payroll `PayrollEmployeeDirectory`는 HR 급여계약·공제 설정이 없는 직원만 월급 300만 원·가족 1명을 쓰고, 퇴직급여 제도는 언제나 퇴직금) |

## 위험

### 규칙 이전 시 동작 차이

현행 규칙 68개를 번들과 매뉴얼에서 추적해 입력·출력 케이스 765건으로 정리했습니다 ([docs/reference/rules](../reference/rules/README.md)). hemr와 달리 화면 컴포넌트가 번들에 없어 원본 함수를 실행하지 못했으므로 **모든 케이스가 추적(`traced`)** 입니다. 열린 질문 233개의 결정은 [rule-decisions/](rule-decisions/README.md)에 있고, 그중 보류가 32개입니다(처음 50개 중 12개는 법령 원문으로, Payroll 6개는 급여 기준표 원문으로 정했습니다).

| 결정이 필요한 대표 차이 | 규칙 |
|---|---|
| 간이세액 산식 결과(300만원·1인 60,380원)가 기억하는 공식 표 값(74,350원)과 약 1만 4천원 다름. 공식 표를 넣기 전까지 근로소득세는 추정치 | [simple-income-tax](../reference/rules/simple-income-tax.md) |
| 장기요양 비율, 2026-07 이후 국민연금 상하한, 퇴직소득 공제표가 미확인 | [social-insurance-premiums](../reference/rules/social-insurance-premiums.md), [severance-pay](../reference/rules/severance-pay.md) |
| 1년 계약의 "1년 이상" 경계를 바꿔 12-31 종료 계약도 수습 감액 허용 | [work-contract-validation](../reference/rules/work-contract-validation.md) |
| 세무 약관 재동의를 "사용자의 아무 회사"가 아니라 현재 회사 기준으로 판정 | [terms-reagreement](../reference/rules/terms-reagreement.md) |
| PG 매출과 현금영수증을 현행처럼 중복 집계할지 | [realtime-pl-inclusion](../reference/rules/realtime-pl-inclusion.md) |
| 홈 부가세 기한을 휴일 보정 없이 25일로 근사 | [vat-due-date-approximation](../reference/rules/vat-due-date-approximation.md) |
| 분납이 있을 때 납부 기한이 신고 기한과 같은지, 간이과세자·중간예납·연말정산 신고 건 | [filing-obligations](../reference/rules/filing-obligations.md) |

### 데이터 이관

- 현행 ID는 도메인마다 정수(HR)와 문자열(회사)로 다르고, 회사는 nexus ID와 `sfCompanyId` 두 개입니다. 이관 때 접두사 ULID로 바꾸는 대응표를 만들어야 하고, 외부 시스템(홈택스 수임, 파트너)에 넘긴 ID가 있는지 확인해야 합니다
- 한글 상태(`임시저장`, `퇴사처리중`)와 소문자 상태(`request`, `done`) → 영문 enum 대응표가 이관 스크립트의 입력입니다. 각 도메인 문서의 용어 표를 그대로 씁니다
- 주민등록번호 암호문과 HMAC 키를 새 키 체계(KMS 봉투 암호화)로 다시 암호화해야 합니다

### 분석 근거의 한계

- 화면 컴포넌트가 lazy chunk라 번들에 없어서, 응답 형태 상당수가 데모 목업과 매뉴얼 스크린샷으로 추정한 값입니다
- 서버에서만 일어나는 처리(구독 갱신, 월 청구, 4대보험 신고 처리, 원천세 자동 연계)의 정확한 조건은 추정입니다
- 급여 요율·세율 다수가 기억에 의존한 값입니다. 기준표의 `verification` 표시를 지우기 전에 법령·고시 원문 확인이 필요합니다

## 구현 상태

| 컨텍스트 | 구현 | 설계만 |
|---|---|---|
| Identity & Access | 로그인·refresh 회전·로그아웃·회사 전환, 대리인 범위 토큰(`:switch-agency`)과 `/agency/companies`, `/me`, 약관 동의, 회사 등록·수정, 구성원·역할·초대, 감사 로그 | 비밀번호 재설정, 이메일 가입, 소셜·파트너 로그인, 메뉴 즐겨찾기 |
| Billing | 구독, 결제 일정·재시도, 출금 동의, 상담, 서비스 계약 | 출금 동의서 업로드, 공개 리드, 계약 서명 흐름 |
| Integrations | 연동 등록·한도, 인증서 자격, 수집 요청·쿨다운·재시도, 수임동의 조회, 사업자 상태조회, 메신저 채널 | 자동 수집 스케줄러, 인증서 만료 알림, 수임동의 생성 |
| Assistant | 대화, 도구 제안(플랜·권한별), 지원금 추천 | 실제 LLM 어댑터, 스트리밍, 지원금 수집 |
| Tax | 신고 건과 커맨드 14개, 필요 자료, 신고 일정 계산·스케줄러 서비스, 할 일 카드, 예상 부가세, 대리인 작업 큐(`/agency/filings`, `/agency/action-cards`) | 수정신고, 스케줄러 상시 실행, 파일 저장소 |
| HR | 직원, 휴직, 근로계약, 급여계약(파생 금액·최저임금 경고·계좌 원문 조회), 소득세 공제 설정, 4대보험 판정, 부서·직위, `HrDirectory` | 인적공제 대상자(가족) API, 퇴직 정보, 메모, 문서 보관함, 4대보험 신고 처리 |
| Documents | 전자서명 요청·서명 링크·본인확인·완료, 제증명 발급·발송, 기본 템플릿 | 회사별 템플릿, 서식 모음, 직인·알림 수신자 설정, 묶음 다운로드 |
| Payroll | 계산 엔진 전체, 기준표, 급여 설정, 급여대장과 행, 명세서 발송, 퇴직금 정산, 인건비 | 엑셀 가져오기 Job, 지급·공제 항목 카탈로그, 수동 보정, 중간정산, 명세서 PDF |
| Bookkeeping | 증빙·분류, 계정과목, 자동분류 규칙, 계좌·입출금·잔액, 정산 연결, 거래처, 거래명세서·세금계산서, 지로, 실시간 손익·자금 현황·홈 요약·인건비, 수집 반영 | 규칙 미리보기, 매출·매입 현황 API, 엑셀 내보내기, 손익 정책 설정 |
| 공통 | Problem Details, 검증, 커서 페이지, `If-Match`, 인증·인가, 컨텍스트 간 어댑터(`wiring/`), SQLite 저장소·요청 트랜잭션·outbox(D1) | `/jobs`, `Idempotency-Key` 재응답 저장소, SSE, 파일 저장소 |
| 현행 호환(BFF, `apps/bff`) | 세션 쿠키·CSRF ↔ 토큰 번역, 경로 회사 전환, 오류·키·enum 번역, 로그인·로그아웃·내 정보·`/jwt`·회사 상세, 구성원 목록·탭 건수·상세 | 나머지 화면 조각, 공유 세션 저장소(여러 인스턴스), 미대응 경로 집계 |

## 결정

2026-11-05에 정했습니다.

| # | 질문 | 결정 | 영향 |
|---|---|---|---|
| D1 | 저장소 | **SQLite + outbox.** 파일 DB 하나에 컨텍스트별 테이블을 두고, 상태 변경과 같은 트랜잭션에서 outbox에 이벤트를 씁니다 | 메모리 구현은 테스트용으로 남깁니다. 동시 쓰기는 한 프로세스로 제한되므로, 여러 인스턴스로 늘릴 때 PostgreSQL을 다시 검토합니다 |
| D2 | 현행 클라이언트를 어떻게 옮기는가 | **단계적.** `apps/api/legacy/`의 경로·응답 형태 지식으로 얇은 BFF를 두고, 화면을 새 API로 하나씩 옮깁니다 | BFF는 별도 앱 `apps/bff`이고 새 API를 HTTP 계약으로 부릅니다. 첫 조각(로그인·로그아웃·내 정보·회사 전환·회사 상세, 구성원 목록·탭 건수·상세)이 있습니다([bff.md](bff.md)). `legacy/`는 나머지 조각을 옮길 때까지 둡니다 |
| D3 | 세무 대리인이 여러 회사를 한 번에 다루는 작업 큐 | **대리인 전용 범위의 토큰**과 `/agency/*` 리소스. 회사 리소스는 그대로 회사 토큰으로만 접근합니다 | **구현.** `POST /auth/sessions:switch-agency`가 `scope: AGENCY` 토큰을 주고, 범위가 틀리면 403 `TOKEN_SCOPE_MISMATCH`입니다. 담당 회사는 토큰에 넣지 않고 요청마다 배정에서 계산합니다. `/agency/companies`(Identity & Access), `/agency/filings`·`/agency/action-cards`(Tax)는 읽기 전용이고 처리는 회사 토큰으로 합니다. 회사별 일감 개수는 Tax 공개 서비스 `AgencyWorkloadQuery`를 `AgencyWorkload` 포트로 받습니다 ([agency-queue.md](agency-queue.md), [identity-access.md](identity-access.md#토큰-범위)) |
| D4 | 공식 간이세액표 | **산식(`MIDPOINT_FORMULA`) 유지.** 결과는 추정치이므로 미확인 표시를 유지합니다 | 300만원·1인 기준 공식 표(74,350원)와 약 1만 4천원 차이. 전략이 기준표 데이터라 나중에 코드 변경 없이 표로 바꿀 수 있습니다 |
| D5 | 대리인 권한 범위 | **분리.** 대리인은 구성원 관리·AI 비서를 기본으로 갖지 않습니다. 권한 카탈로그에 대리인 전용(`agentOnly`) 표시를 두고, 대리인 기본 권한 `AGENT_PERMISSIONS`는 구성원 관리(`member`·`role`·`invitation`·`audit-log`)와 AI 비서(`conversation`·`grant`)를 뺀 카탈로그 리소스 전부를 `resource:*`로, 대리인 전용 동작 `filing:process`·`subscription:manage`·`payment:retry`·`payment:refund`를 하나씩 적습니다 (2026-11-06) | **구현.** 회사 범위의 대리인 행위자와 대리인 범위 토큰(`authorizeAgency`)이 같은 표를 봅니다. 와일드카드는 대리인 전용 권한을 덮지 않아 Billing의 `actor.kind` 검사를 권한 문자열로 바꿨습니다. 대리인은 `/users`·`/roles`·`/invitations`·`/audit-logs`와 `/conversations`·`/grants`가 403이고 `/me`의 `permissions`가 `*` 대신 이 목록입니다. 고객 쪽 판정은 그대로이고, 고객이 대리인 신고 커맨드를 부를 때의 오류 코드(`FILING_ACTOR_NOT_ALLOWED`)도 유지합니다. 고객 사용자의 역할 화면(`GET /permissions`)에는 카탈로그에 새로 올린 리소스(`filing`, `organization`, `payroll-workflow` …)와 빠져 있던 동작 17개(`employee:reveal-rrn`, `payroll-ledger:close` …)가 부여 가능 권한으로 더해집니다. 소스의 권한 문자열이 모두 카탈로그에 있는지 테스트가 확인합니다 ([identity-access.md](identity-access.md#권한-카탈로그), [rule-decisions/assistant.md](rule-decisions/assistant.md#assistant-tool-access)) |
| 공휴일 | 5월 1일(근로자의 날) | **휴일로 둡니다.** 국세 기한과 CMS 출금일 모두 다음 영업일로 미룹니다 | 공용 공휴일 표(`shared/time/public-holidays.ts`) 그대로 |

## 결정 필요

| # | 질문 | 선택지 | 권장 |
|---|---|---|---|
| D6 | 플랜 변경 반영 시점 | 토큰 만료까지 지연 / `subscription.changed`로 즉시 토큰 폐기 | 즉시 폐기 |
| D7 | 파일 저장소(`fle_`) 소유와 다운로드 권한 | 컨텍스트별 / 공통 Files 모듈 | 공통 모듈. 다운로드 권한은 파일을 붙인 리소스의 읽기 권한을 따름 |
| D8 | AI 비서 데이터 정책 | | 대화 보존 기간, 외부 모델 전송, 회사 공유 여부를 약관과 함께 정함 ([compliance.md](compliance.md#ai-비서)) |
| D9 | 첫 구현 범위 | | Identity & Access → HR → Payroll → Tax(원천세). 급여 마감에서 원천세까지 하루 업무가 돌아가는 최소 경로 |

## 다음 단계

1. **공식 기준표 확인.** 급여 기준표의 미확인 값을 법령·고시 원문으로 채웁니다. 간이세액표는 산식을 유지합니다 (D4). 2026-11-05에 대부분 확인했고(2026-03·2026-07 기준표 추가), 장기요양 비율 반올림과 고용·산재보험 절사 단위만 미확인입니다
2. **남은 보류 규칙 결정.** [rule-decisions/](rule-decisions/README.md)의 보류 50개 중 12개는 법령 원문으로, Payroll 6개는 급여 기준표 원문으로 정했습니다(HR 보육수당 비과세 나이는 소득세법 제12조제3호머목2)로 정함). 남은 32개 중 Payroll 8개는 남은 기준표 확인(1번)과 함께 정합니다. 나머지는 상시 근로자 수 같은 새 입력, 내부 자료(약관·메뉴 코드, CMS 계약), 외부 서비스 자료(수집 업체, 메신저 브리지, 홈택스 발급)가 있어야 정할 수 있습니다
3. **대리인 큐 확장.** 대리인 범위 토큰과 `/agency/*`(D3), 대리인 권한 분리(D5)를 구현했습니다. 대리인 범위와 회사 범위가 같은 `AGENT_PERMISSIONS`를 보므로 새 큐도 권한 문자열만 고르면 됩니다. 남은 것은 Payroll·Integrations의 대리인 큐를 같은 방식으로 늘릴지 정하는 일입니다([agency-queue.md](agency-queue.md#열린-질문) 1번). 대리인에게 구성원 관리나 AI 비서를 회사별로 열어 줄 필요가 생기면 배정에 권한 추가를 두는 방식을 그때 정합니다
4. **BFF 다음 조각 (D2).** 인사 하위 리소스(근로·급여계약, 휴직, 퇴직)는 [bff.md](bff.md#인사-하위-리소스-조각)에, 급여대장의 읽기와 생애 주기(목록·상세·만들기·이름·계산 확정·확정·해제·추가 카드·삭제)는 [bff.md](bff.md#급여대장-조각)에, 급여카드 명세서의 화면 읽기·발송 현황·발송은 [bff.md](bff.md#명세서-조각)에, 원천세 신고 건의 목록·상세·제출 자료 응답·제출·제출 취소·납부와 급여의 원천세 요약은 [bff.md](bff.md#원천세-조각)에 더했습니다. 현행 클라이언트는 발송에 `Idempotency-Key`를 보내지 않으므로 BFF가 세션·명세서 집합의 지문으로 키를 붙이고(클라이언트 키도 세션·대상에 묶음) 60초 안의 같은 발송은 새 API가 재응답하게 해 두 번 누르기·재시도가 메일을 두 번 보내지 않습니다. 새 `:send`도 키를 처리 전에 예약하고 본문을 비교하게 되어 처리 중 재시도·발송 도중 실패의 중복 발송 창이 닫혔습니다(BFF는 처리 중 409를 결과를 모르는 실패로 봐 키를 24시간 지킴). 명세서 발송에 남은 갈아타기 조건은 아래 플랜 결정과, 실제 메일 연동 전에 발송을 요청 트랜잭션 밖으로 옮기는 것입니다. 급여대장의 행 입력 저장(임시저장), 명부 갱신, 이전 달 복사, BPO 명세서·명세서 PDF와 원천세의 파일·다른 세목·세무 일정·대리인 경로는 [남은 것](bff.md#급여대장에서-남은-것)·[명세서에서 남은 것](bff.md#명세서에서-남은-것)·[원천세에서 남은 것](bff.md#원천세에서-남은-것)이고, D9의 첫 범위(인증·회사 → 인사 → 급여대장 → 명세서 → 원천세)는 이것으로 모두 BFF에 있습니다. 원천세 파일 경로는 파일 저장소(D7)를 기다립니다. 그 전에 조각들이 드러낸 빈 필드를 새 API에 더할지 정합니다: 첫 조각의 다른 회사 플랜·관리자 여부, 사번·담당업무, 현재 계약 요약, 인사 하위 리소스의 퇴직금 설정(제도·중간정산·퇴직금), 근로계약 수정·취소와 근무 형태, 휴직 수정([열린 질문](bff.md#열린-질문)), 급여대장의 소득 구분별 집계, 행 입력의 지급항목 ID, 해제 한 커맨드, 행 소득자 사본, 고객의 확정·해제 허용 여부([급여대장 열린 질문](bff.md#급여대장-열린-질문)), 명세서 수신 주소·발송 기록·발송 여부 요약([명세서 열린 질문](bff.md#명세서-열린-질문)), 원천세 요약 조회 엔드포인트, 원천세 요약의 플랜(대장 읽기에 `PAYROLL`이 필요, `TAXATION`이 없으면 `filing: null`), 고객 경로에서 대리인의 제출·제출 취소·납부(현행은 고객으로 기록, 새 API는 403)와 제출 자료 응답(새 API는 대리인으로 기록), 신고 건 기간 필터([원천세 열린 질문](bff.md#원천세-열린-질문)). 퇴직금 정산의 지급일은 정했습니다(2026-11-07): 새 `SeveranceSettlement.paymentDate`로 요약의 퇴직소득 `A21`을 지급월의 완료 정산으로 채웁니다. **급여대장 조각을 현행 클라이언트에 열기 전에 정할 것: 어떤 플랜이 급여대장을 여는가.** 현행 급여 관리는 기장(`TAXATION`) 메뉴인데 새 급여대장은 `PAYROLL`만 받아, 지금은 기장만 쓰는 회사의 급여카드·명세서 경로가 모두 403 `ENTITLEMENT_REQUIRED`입니다(`/v1` 변경이 필요한 제품 결정, [bff.md](bff.md#급여대장-조각)). 스테이징에서 BFF 404·422(`Not supported by the new API yet.`)를 경로·필드별로 모아 남은 조각을 셉니다
5. **공통 도우미 정리.** 저장 표는 `src/shared/persistence`로, HTTP 테스트 앱은 `src/shared/testing/http-test-app.ts`로 모았습니다. 컨텍스트별 도우미(`testing-http`, `tax-http.testing`, `http-test-support`, `payroll-testing`, `test-app`)는 토큰 표와 덮어 쓸 레이어만 정하는 얇은 래퍼입니다
6. **이전 구현 정리.** BFF가 모든 조각을 덮고 화면이 새 API로 옮겨 가면 `apps/bff/`와 `apps/api/legacy/`를 함께 지웁니다. 그 전까지 `legacy/`는 BFF 조각의 경로·응답 형태 근거입니다
7. **보안 후속 (PR #8 리뷰).** 아래 하나만 남았습니다
   - 세무 신고에 붙는 파일 ID(`ledgerFileId`, `returnFileId`, `paymentSlipFileId`, `noticeFileId`, `fileId`)는 회사 확인 없이 저장됩니다. 파일 저장소(D7)가 생기면 파일 소유 회사를 확인하고, ID만으로 내려받지 못하게 합니다 ([tax.md](tax.md))
   - 2026-11-06에 고친 것: SQLite 시드는 표마다 한 번만 넣습니다(`semu_meta`의 `seeded:<표>`, [conventions.md](conventions.md#코드-구조)). 키 지문 없이 데이터가 있는 데이터베이스는 시작을 거부합니다. 결함 로그는 오류 이름과 코드 위치만 남기고 메시지는 `DecryptionFailed`만 남깁니다. 도장 이름은 50자까지입니다. Bookkeeping 계좌번호는 회사 계좌·거래처 계좌·지로 출금 계좌마다 용도(하위 키·AAD)가 다릅니다([compliance.md](compliance.md#개인정보-최소-노출)). onboarding token은 회사를 등록하면 지웁니다([identity-access.md](identity-access.md)). BFF는 업스트림 응답 본문을 10MB까지만 읽습니다([bff.md](bff.md))
