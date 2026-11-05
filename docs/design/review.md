# 설계 검토

재설계가 현행 업무를 빠짐없이 덮는지, 무엇을 일부러 바꿨고 그 대가가 무엇인지, 구현 전에 누가 무엇을 정해야 하는지 정리합니다.

## 요약

| 항목 | 판단 |
|---|---|
| 업무 범위 | 현행 세 백엔드(nexus·sf·remittance)가 다루는 업무는 모두 대응 리소스가 있습니다. 세무 대리인 데스크 화면, 엑셀 내보내기, 일부 설정 화면처럼 [구현 상태](#구현-상태)에 적은 항목은 설계만 있습니다 |
| 가장 큰 개선 | 급여대장 마감 → 원천세, 전자서명 완료 → 계약, 수집 → 증빙이 서버 안 연계가 되어 "대장은 마감됐는데 신고 항목은 미제출" 같은 불일치가 구조적으로 사라집니다 |
| 가장 큰 위험 | **현행 클라이언트를 재사용할 수 없습니다.** 경로·키·enum·오류 형식이 모두 바뀌었습니다. 그리고 급여 요율·간이세액 다수가 미확인이라 계산 결과가 실제와 다를 수 있습니다 |
| 가장 큰 미결 | 저장소(PostgreSQL + outbox), 세무 대리인의 여러 회사 작업 큐, 공식 간이세액표 적용 여부 |

## 엔드포인트 대응

현행 `method + path`를 컨텍스트 단위로 대응시켰습니다. 행 단위 표는 각 문서의 **현행 엔드포인트 대응** 절에 있습니다.

| 현행 그룹 | 개수(약) | 재설계 | 비고 |
|---|---:|---|---|
| nexus 인증·사용자·권한·회사·약관·초대 (spec platform #1–30, 45–70, 75–77) | 70 | [identity-access.md](identity-access.md) | 세션 쿠키+CSRF와 회사 JWT를 액세스 토큰 + refresh 쿠키 하나로. 권한 확인·메뉴 트리 API(#52–56)는 `/me`로 대체 |
| nexus 구독·결제·계약·상담·파트너 (#26, 71–74, 78, 81 등) | 20 | [billing.md](billing.md) | sf의 nexus 구독 프록시(#74) 폐지 |
| remittance 연동·인증서·수집·상태조회 (#32–33, 82–128) | 50 | [integrations.md](integrations.md) | `/integrations/v2/` → `/integrations`, 수집 폴링 → `Job` |
| AI 비서·지원금 | 8 | [assistant.md](assistant.md) | |
| sf 세무 (`/tax/:taxType/*`) + 세무 대리인 데스크 (`/desk/filings/*`) | 34 | [tax.md](tax.md) | 세목별 경로를 `/filings` 하나와 커맨드 14개로. 홈 트래커는 `GET /filings?open=true` |
| sf 인사 (`/employment/*`) | 101 | [hr.md](hr.md) | 근로·일용·사업·기타 경로 네 벌을 `Employee.kind` 하나로 |
| sf 전자서명·제증명 + `/nexus-api/document-form` | 40 | [documents.md](documents.md) | `/nexus-api/` 예외 경로 폐지 |
| sf 급여 (`/payroll/*`, `/employment/settings/*`, 급여계산기) (#1–155) | 155 | [payroll.md](payroll.md) | 일반 카드와 BPO 카드, BPO 구간별 입력 경로(#46–98)를 `/payroll-ledgers`와 `/rows` 하나로 |
| remittance·sf 경리·보고서 (`/transaction-sales/*`, `/giros/*`, `/evidence/*`, `/report/*`) | 71 | [bookkeeping.md](bookkeeping.md) | `/api/v2/.../giros/:id/payment` → `:pay`, 인건비 보고서는 Payroll 조회로 |

### 범위 밖으로 둔 것

| 현행 | 이유 |
|---|---|
| 세무 대리인 내부 업무 도구의 화면과 그 전용 API(담당자 배정 관리, 기장 입력) | 번들에 없고 고객 앱 범위가 아님. 대리인이 고객 회사에서 하는 동작만 `actor.kind = AGENCY`로 다룸 |
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
| Tax | `filing:read/update/submit/confirm-ledger/pay`, 대리인 `filing:process`, `action-card:read/complete`, `estimated-vat:read` | TAXATION + 약관 |
| HR | `employee:read/create/update/delete/resign/reveal-rrn`, `organization:read/update` | PAYROLL 또는 TAXATION |
| Documents | `esign-request:*`, `esign-template:read`, `certificate-issuance:*`, `document-form:read` | PAYROLL |
| Payroll | `payroll-setting:*`, `payroll-workflow:update`, `payroll-rate-table:read`, `payroll-calculator:simulate`, `payroll-ledger:*`, `payslip:read/send`, `severance-settlement:*`, `labor-cost-report:read` | PAYROLL (인건비는 PAYROLL 또는 TAXATION) |
| Bookkeeping | `evidence:*`, `account-title:*`, `classification-rule:*`, `bank-account:*`, `bank-transaction:*`, `partner:*`, `sales-transaction:*`, `tax-invoice:read/issue`, `giro:read/update/pay`, `report:read`, `settlement-report:read` | 결산 보고서는 TAXATION |

- 관리자와 배정된 세무 대리인은 `*`를 받습니다. 역할은 권한 묶음 프리셋입니다
- 대리인 전용 권한(`filing:process`, `subscription:manage`)은 지금 컨텍스트마다 `actor.kind`로 따로 판정합니다. 카탈로그에 "대리인 전용" 표시를 두는 것이 [결정 필요](#결정-필요) D5입니다

## 일부러 바꾼 것과 그 대가

| 결정 | 얻는 것 | 대가 |
|---|---|---|
| 와이어 형식 전면 변경(camelCase, `/v1`, 커서, RFC 9457) | 형식 일관성, 키 변환 인터셉터·`LEGACY_RAW_KEYS` 제거 | **현행 클라이언트를 그대로 쓸 수 없음.** 이전 호환 구현(`apps/api/legacy/`)이 하던 일을 버림. 클라이언트를 고치거나 호환 계층(BFF)을 따로 둬야 함 (D2) |
| 경로에서 회사 ID 제거, 토큰 하나 = 회사 하나 | 회사 범위 검사가 한 곳(인증)에 모임. nexus·sf 회사 ID 통합 | 회사 전환마다 토큰 재발급. 대리인이 여러 회사를 한 화면에서 보는 작업 큐는 별도 설계 필요 (D3) |
| 상태 enum + 커맨드 | 전이 규칙이 서버 한 곳에 | 엔드포인트 수가 늘어 보임(신고 커맨드 14개, 급여대장 9개) |
| 직원 상태를 저장하지 않고 날짜로 파생 | 입사·휴직·퇴사 예정이 자동 반영 | 목록 필터가 "오늘" 기준 계산을 매번 함. 저장소에서 인덱스로 거를 수 없음 |
| 세무·급여 기록 삭제 금지, 정정·제외 상태 | 보존 의무 충족, 감사 가능 | 저장 공간 증가. "지웠는데 남아 있음"에 대한 사용자 안내 필요 |
| 원천세가 신고되면 그 달 급여대장 잠금 | 신고 금액과 대장의 불일치 방지 | 신고 후 정정은 수정신고 흐름이 생기기 전까지 막힘 |
| 플랜을 Billing 구독에서 파생 | 플랜 캐시 동기화 제거 | 구독이 바뀌어도 액세스 토큰 만료(10분)까지 이전 플랜으로 동작 (D6) |
| 모듈러 모놀리스 + 포트·어댑터 | 트랜잭션 경계가 단순, 컨텍스트 경계가 코드에 드러남 | 포트마다 어댑터를 `wiring/`에 유지해야 함. 제공 쪽 데이터가 부족한 포트는 기본값으로 채움 |

## 위험

### 규칙 이전 시 동작 차이

현행 규칙 68개를 번들과 매뉴얼에서 추적해 입력·출력 케이스 765건으로 정리했습니다 ([docs/reference/rules](../reference/rules/README.md)). hemr와 달리 화면 컴포넌트가 번들에 없어 원본 함수를 실행하지 못했으므로 **모든 케이스가 추적(`traced`)** 입니다. 열린 질문 233개의 결정은 [rule-decisions/](rule-decisions/README.md)에 있고, 그중 보류가 51개입니다.

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
| Identity & Access | 로그인·refresh 회전·로그아웃·회사 전환, `/me`, 약관 동의, 회사 등록·수정, 구성원·역할·초대, 감사 로그 | 비밀번호 재설정, 이메일 가입, 소셜·파트너 로그인, 메뉴 즐겨찾기 |
| Billing | 구독, 결제 일정·재시도, 출금 동의, 상담, 서비스 계약 | 출금 동의서 업로드, 공개 리드, 계약 서명 흐름 |
| Integrations | 연동 등록·한도, 인증서 자격, 수집 요청·쿨다운·재시도, 수임동의 조회, 사업자 상태조회, 메신저 채널 | 자동 수집 스케줄러, 인증서 만료 알림, 수임동의 생성 |
| Assistant | 대화, 도구 제안(플랜·권한별), 지원금 추천 | 실제 LLM 어댑터, 스트리밍, 지원금 수집 |
| Tax | 신고 건과 커맨드 14개, 필요 자료, 신고 일정 계산·스케줄러 서비스, 할 일 카드, 예상 부가세 | 대리인 작업 큐, 수정신고, 스케줄러 상시 실행, 파일 저장소 |
| HR | 직원, 휴직, 근로계약, 4대보험 판정, 부서·직위, `HrDirectory` | 급여계약·공제·가족 API, 퇴직 정보, 메모, 문서 보관함, 4대보험 신고 처리 |
| Documents | 전자서명 요청·서명 링크·본인확인·완료, 제증명 발급·발송, 기본 템플릿 | 회사별 템플릿, 서식 모음, 직인·알림 수신자 설정, 묶음 다운로드 |
| Payroll | 계산 엔진 전체, 기준표, 급여 설정, 급여대장과 행, 명세서 발송, 퇴직금 정산, 인건비 | 엑셀 가져오기 Job, 지급·공제 항목 카탈로그, 수동 보정, 중간정산, 명세서 PDF |
| Bookkeeping | 증빙·분류, 계정과목, 자동분류 규칙, 계좌·입출금·잔액, 정산 연결, 거래처, 거래명세서·세금계산서, 지로, 실시간 손익·자금 현황·홈 요약·인건비, 수집 반영 | 규칙 미리보기, 매출·매입 현황 API, 엑셀 내보내기, 손익 정책 설정 |
| 공통 | Problem Details, 검증, 커서 페이지, `If-Match`, 인증·인가, 컨텍스트 간 어댑터(`wiring/`) | 저장소(PostgreSQL + outbox), `/jobs`, `Idempotency-Key` 재응답 저장소, SSE, 파일 저장소 |

## 결정 필요

| # | 질문 | 선택지 | 권장 |
|---|---|---|---|
| D1 | 저장소 | 메모리(현재) / PostgreSQL + outbox / 이전 구현의 SQLite 재사용 | PostgreSQL + outbox. 컨텍스트별 스키마, outbox 릴레이로 [events.md](events.md)의 전달 보장 |
| D2 | 현행 클라이언트를 어떻게 옮기는가 | 클라이언트 재작성 / 현행 와이어를 받는 호환 계층(BFF) / 둘 다 단계적으로 | 단계적. `apps/api/legacy/`의 경로·응답 형태 지식으로 얇은 BFF를 두고, 화면을 새 API로 하나씩 옮김 |
| D3 | 세무 대리인이 여러 회사를 한 번에 다루는 작업 큐 | 회사별 토큰만 / 대리인 전용 교차 회사 토큰과 `/agency/*` 리소스 | 대리인 전용 범위의 토큰. 회사 리소스는 그대로 회사 토큰으로만 |
| D4 | 공식 간이세액표 | 산식(중간값) 유지 / 공식 표 데이터 탑재 | 공식 표 탑재. 산식은 표 범위 밖과 설명용으로만 |
| D5 | 대리인 권한 범위 | `*` 그대로 / 대리인 전용 권한과 고객 관리 권한 분리 | 분리. 대리인은 구성원 관리·AI 비서를 기본으로 갖지 않음 |
| D6 | 플랜 변경 반영 시점 | 토큰 만료까지 지연 / `subscription.changed`로 즉시 토큰 폐기 | 즉시 폐기 |
| D7 | 파일 저장소(`fle_`) 소유와 다운로드 권한 | 컨텍스트별 / 공통 Files 모듈 | 공통 모듈. 다운로드 권한은 파일을 붙인 리소스의 읽기 권한을 따름 |
| D8 | AI 비서 데이터 정책 | | 대화 보존 기간, 외부 모델 전송, 회사 공유 여부를 약관과 함께 정함 ([compliance.md](compliance.md#ai-비서)) |
| D9 | 첫 구현 범위 | | Identity & Access → HR → Payroll → Tax(원천세). 급여 마감에서 원천세까지 하루 업무가 돌아가는 최소 경로 |

## 다음 단계

1. **D1·D2 결정.** 저장소와 클라이언트 이전 방식이 정해져야 운영 배포를 계획할 수 있습니다
2. **공식 기준표 확인.** 급여 기준표의 미확인 값과 간이세액표를 법령·고시 원문으로 채웁니다 (D4)
3. **보류 규칙 결정.** [rule-decisions/](rule-decisions/README.md)의 보류 51개를 외부 사실 확인 후 정합니다
4. **outbox.** D1이 정해지면 발행 포트를 outbox로 바꿉니다. 이벤트 이름은 이미 [events.md](events.md)의 snake_case 규칙을 따릅니다
5. **공통 도우미 정리.** 컨텍스트마다 중복된 메모리 테이블·테스트 도우미를 `src/shared`로 모읍니다
6. **이전 구현 정리.** 이식이 끝난 뒤 `apps/api/legacy/`를 지웁니다. 지금은 D2의 BFF 근거로 둡니다
