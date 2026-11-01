# 인사(HR) 도메인 설계

`apps/api/src/modules/hr/**`와 마이그레이션 `0020-hr.sql`의 설계 기록입니다. 근거 스펙은 [`docs/spec-notes/hr.md`](../spec-notes/hr.md), 공통 규칙은 [`docs/api-architecture.md`](../api-architecture.md)입니다.

## 범위

- 스펙 §5의 엔드포인트 101개를 모두 구현했습니다. 경로는 스펙 그대로이고 끝 슬래시 없이 정의합니다(앱이 `strict: false`라 `/`가 붙은 요청도 받습니다).
- 신규 설계로 추가한 엔드포인트
  - `GET/POST /employment/{daily,business,other}-employees`, `GET .../:id`: 번들에는 `PATCH`만 있습니다. 급여 카드 없이도 관리할 수 있게 목록·생성·조회를 추가했습니다.
  - 전자서명: `POST e-sign-requests/:id/send`, 회사 직인 이미지 `GET`, 증명서 `:id/file`.
- 모듈 구성: `employees`(구성원·상태·목록), `memo`, `family`, `leaves`, `contracts`(근로·급여계약), `retirement`, `social-insurance`, `deduction`, `documents`(문서 보관함), `organization`(부서·직위), `non-wage`, `legacy`(직원 관리), `document-forms`(서식 모음), `e-sign`, `certificates`, `adapters`, `shared`.

## 주요 결정

### 식별자와 개인정보

- HR 테이블의 ID는 `INTEGER`입니다. 스펙 응답의 `id`가 숫자이고 문서 인덱스·발급번호 같은 순번이 많아서입니다. 회사 ID는 플랫폼과 같은 `TEXT`입니다.
- 주민등록번호와 여권번호는 `deps.cipher`(AES-256-GCM)로 암호화해 `registration_number_enc`에 저장합니다. 응답에는 항상 `900101-1******` 형태로 마스킹해서 내보냅니다.
- 중복 검사(`DUPLICATE_EMPLOYEE`)는 **HMAC-SHA256 keyed hash**(`registration_number_hash`)로 합니다. 키는 처음 쓸 때 무작위 32바이트로 만들고, `deps.cipher`로 암호화해 `hr_secrets('registration_number_hmac')`에 둡니다. 암호문은 매번 달라서 비교할 수 없고, 평문 해시는 사전 공격에 약해서 이렇게 했습니다. `ENCRYPTION_KEY`를 교체할 때는 이 키도 같이 재암호화해야 합니다.
- 같은 종류(`kind`) 안에서 해시가 같은 직원이 있으면 거절합니다. 예외는 `is_rejoin: true`이고 일치하는 직원이 모두 퇴사 상태인 경우입니다. 에러 본문에 `duplicate_employee_id`가 들어갑니다.
- 수정 요청에서 `*`가 섞인 주민등록번호(마스킹 값)나 생략된 값은 기존 값을 유지한다는 뜻입니다.
- 계좌번호도 암호화하고 끝 4자리만 보여 줍니다.

### 상태 모델

- 직원 상태는 저장하지 않고 날짜로 계산합니다(`employee-view.sql.ts`): `RESIGNED`(퇴사일 < 오늘) → `PRE_JOINED`(입사일 > 오늘) → `LEAVE`(오늘이 휴직 기간 안) → `JOINED`.
- `WORKING`은 목록 필터로만 쓰고 `JOINED`와 같은 집합입니다. `count-by-status`의 `joined`는 재직 전체(`JOINED + LEAVE`), `working`은 휴직자를 뺀 수입니다.
- 레거시 `employment_status`(한글)는 `legacy.utils.ts`가 계산합니다. 주민등록번호가 없으면 `임시저장`이고, 대기 중인 4대보험 신고(`employee_insurance_filings`)가 있으면 `퇴사처리중 > 휴직처리중 > 입사처리중` 순으로 정합니다. 나머지는 재직·휴직·퇴사입니다. 입사 예정자는 레거시에 없는 상태라 재직으로 냅니다.
- 4대보험 신고는 스펙 권고대로 `employee_insurance_filings`로 정규화했습니다. 입사, 퇴사, 휴직, 피부양자 등록이 `pending` 신고를 만듭니다. 처리(`done`) API는 세무 담당 도메인 몫이라 이번 범위에 넣지 않았습니다.

### 동시성

- 상태가 바뀌는 쓰기는 `If-Match`(직원 `version`)가 필요합니다: 휴직 등록·수정·삭제, 퇴사일이 바뀌는 퇴직 정보 `PUT`, 퇴직 정보 `DELETE`, 전자서명 발송·취소·무효화, 증명서 상태 전이. 헤더가 없으면 428, 버전이 다르면 412 `VERSION_CONFLICT`입니다. 응답의 `ETag`로 현재 버전을 알려 줍니다.
- 일반 필드 수정(기본 정보, 계약, 4대보험, 공제, 가족, 메모)은 마지막 쓰기가 이깁니다.

### 유효일(effective dating)

- 4대보험 설정과 공제 설정은 `effective_from`별로 행을 쌓습니다(`UNIQUE(employee, effective_from)`). `PUT`은 `effective_date`(기본값 오늘)부터 효력이 생기고, `GET`은 오늘 효력이 있는 행을 돌려줍니다.
- 근로·급여계약은 `start_date`/`end_date` 구간으로 조회합니다.

### 규칙 구현 메모

- 근로계약(R7): 기간제는 종료일이 필수입니다. 1년 미만 계약은 수습 감액을 할 수 없습니다.
- 무기계약 전환 알림: 이어지는 기간제 계약(공백 없이 연속)을 체인으로 묶습니다. 체인 시작 + 24개월이 전환일이고, 전환일 90일 전부터 `approaching`, 넘으면 `exceeded`입니다. 체인 시작일 기준 만 55세 이상은 예외입니다.
- 계약 만료 경고는 종료일 30일 전부터입니다(`CONTRACT_EXPIRY_WARNING_DAYS`).
- 최저임금은 2026년 시급 10,320원을 씁니다. 고정 연장·야간·휴일 수당 배율(R10)은 확인하지 못해 모두 1.0으로 두었습니다.
- 4대보험 판정: 만 60세 이상이면 국민연금 제외, 주 15시간 미만이면 3개 보험 제외, 월 60시간 미만이면 국민연금 제외, 대표자·임원·동거 친족이면 고용보험 제외, 만 65세 이후 신규 취업이면 고용보험 제외, 외국인은 체류자격 목록으로 판정합니다. `redetermine`은 저장하지 않고 권장값과 `changed_fields`만 돌려줍니다.
- 육아휴직은 365일 한도이고 근속기간에 항상 포함합니다. 1개월 이상 휴직이면 건강보험 고지 유예를 켭니다.
- 퇴직: 퇴사일은 중간정산일보다 앞설 수 없습니다(`LEAVE_DATE_BEFORE_INTERIM`). 퇴직금 정산이 `completed`인 직원은 삭제할 수 없고 퇴직 정보도 지울 수 없습니다(`RETIREMENT_COMPLETED`).
- 부서·직위(R4): 한 번이라도 배정된 항목은 `is_used=1`이 되고, 일괄 저장에서 빠지면 `DEPARTMENT_IN_USE`/`POSITION_IN_USE`로 거절합니다. 일괄 저장은 목록 전체를 교체하는 방식이고 순서가 표시 순서가 됩니다.
- 공제 정보의 `dependents_count`는 본인을 포함한 수입니다(간이세액표 기준).

### 전자서명·제증명

- 기본 템플릿 16종(13–16은 증명서)은 TS 상수로 두고, 회사별 덮어쓰기와 끄기만 `esign_template_overrides`에 저장합니다.
- 발송은 `send: true`로 생성하거나 `POST :id/send`(If-Match)로 합니다. 서명 기한은 발송일 + 16일입니다.
- 서명 링크 토큰은 sha256 해시만 저장합니다. 본인 확인(이름 + 생년월일)에 성공하면 `X-ESign-Session` 세션(30분)을 줍니다. 5번 실패하면 잠기고 429 `IDENTITY_VERIFICATION_LOCKED`입니다.
- 기한 만료는 조회할 때 처리하고(lazy), 배치용 `expireOverdueESignRequests(context, null)`도 있습니다.
- 서명이 완료되면(R29) 근로계약, 급여계약, 문서 보관함 항목을 만들고, 직원이 없으면 새로 등록합니다.
- 증명서 발급번호는 `YYYY-NNNN`이고 삭제된 번호는 다시 쓰지 않습니다. 링크는 30일 동안 유효하고 재발송하면 토큰을 새로 만듭니다. 여러 건을 내려받으면 ZIP입니다.

### 어댑터

`AppDeps`에 선택 필드 `notifier`, `pdfRenderer`, `identityVerifier`를 추가했습니다. 넘기지 않으면 HR 모듈이 가짜 구현을 씁니다(`adapters/fake-adapters.ts`).

- 알림: 메모리 outbox. `@fail.invalid` 주소는 실패로 처리합니다.
- PDF: 결정적인 PDF와 `% hr-data:` 메타데이터 줄.
- 본인 확인: 이름과 생년월일 비교.

### 에러 코드

공통 `ErrorCode` 유니언은 플랫폼이 소유하는 닫힌 타입이라, `HrError`(`DomainError` 하위 클래스)가 런타임에 `code`와 `status`를 바꿔 씁니다. 병합할 때 아래 코드를 공통 유니언에 추가하는 것을 제안합니다.

| 코드 | HTTP |
| --- | --- |
| `DUPLICATE_EMPLOYEE`, `RETIREMENT_COMPLETED`, `LEAVE_DATE_BEFORE_INTERIM`, `LEAVE_OVERLAP`, `DEPARTMENT_IN_USE`, `POSITION_IN_USE`, `SEAL_LIMIT_EXCEEDED` | 400 |
| `SIGNER_SESSION_REQUIRED`, `SIGNER_SESSION_INVALID` | 401 |
| `IDENTITY_VERIFICATION_FAILED` | 403 |
| `SIGNING_TOKEN_INVALID` | 404 |
| `SIGNING_CLOSED` | 410 |
| `IDENTITY_VERIFICATION_LOCKED` | 429 |

## 스펙과 다른 점

- 메뉴 `employee_management`의 path를 `/employment`(레거시 리포트 앱 경로)로 바꿨습니다. 현재 메뉴 트리 leaf의 `to`는 `/employee`라서 같이 바꿔야 합니다(아래 메뉴 절 참고).
- 서식 모음은 테이블 없이 TS 상수(`document-forms.catalog.ts`)로 둡니다. 매뉴얼 목록이 39종이고(스펙 본문의 40은 목록 페이지를 센 것), 원본 파일이 저장소에 없어 `file_url`은 `null`입니다.
- `/nexus-api/document-form*`은 `/api/*` 밖이라 라우트마다 `authenticate(deps)`를 붙였습니다. 구독과 관계없이 로그인한 사용자 누구나 쓸 수 있습니다.
- 근로자가 올린 파일(서명자 직인, 서명 PDF)의 `files.uploaded_by`는 요청을 만든 회사 사용자로 기록합니다. `files.uploaded_by`가 사용자 FK라서입니다.
- 직원을 삭제해도 `files` 행은 남깁니다(다른 참조와 공유할 수 있음). 블롭 정리는 저장소 GC 몫입니다.
- 회사의 급여 플랜(`has_payroll_plan`) 시드는 플랫폼 몫이라 그대로 두었습니다. 그래서 데모 `c-corp`는 구성원 정보 화면이 403이고, 테스트는 헬퍼(`createHrTestContext`)가 플랜을 켭니다.
- 고용보험 상호주의 국가 목록(`EI_RECIPROCITY_COUNTRIES`)은 확인한 자료가 없어 비워 두었습니다.
- 공통 PATCH(전자서명 초안 수정)는 If-Match 없이 받고, `send: true`일 때만 요구합니다.

## 추정 응답

번들에서 확인하지 못해 추정한 응답 형태입니다.

| 엔드포인트 | 응답 |
| --- | --- |
| `GET /nexus-api/document-form` | DRF 페이지 `{count,next,previous,results:[{id,title,description,type,file_url}]}` |
| `GET /nexus-api/document-form/type-count` | `[{type,count}]` (6개 카테고리 고정 순서) |
| `GET employee/leaving-reason` | `[{code,name,children:[{code,name}]}]` (고용보험 상실사유 코드) |
| `GET employee` (`simple=False`) | 목업 필드 + `employee_work`는 `is_{kind}_work`, `{kind}_work_time`만 |
| `GET wage-employees/count-by-status` | `{all,pre_joined,working,joined,leave,resigned}` |
| `GET wage-employees/contract-expiry-alert` | `{threshold_days,threshold_date,expiring_soon_count,expired_count,employees:[{id,name,department_name,position_name,contract_end_date,days_left,status}]}` |
| `GET work-contracts/indefinite-conversion-alert` | `{is_target,status,is_exempt,exempt_reason,chain_start_date,chain_end_date,total_contract_days,conversion_date,days_until_conversion}` |
| `GET social-insurance-info/redetermine` | 설정 + `{determinations,messages,recommended,changed_fields,is_saved}` |
| `GET/POST departments`, `positions` (+`/bulk`) | DRF 봉투 `{count,next:null,previous:null,results:[{id,name,order,is_used}]}`; 요청은 `[{id?,name}]` 또는 `{items:[...]}` |
| `GET documents` | DRF 페이지, 항목 `{id,employee,category:{id,code,name},source_type,source_id,file_name,mime_type,size,created,created_by}` |
| `GET memo-histories` | DRF 페이지 `{id,action,content,created,created_by}` |
| 비근로소득자 `PATCH`/`GET` | 공통 정보 + `{status,join_date,leave_date,daily_wage,business_code,other_income_code,bank_code,account_number(마스킹),account_holder}` |
| `GET settings/document-categories` | `[{id,code,name}]` |
| 서명자 `summary` | `{status,company_name,recipient_name(마스킹),documents,due_date,expired,requires_birth_date}` |
| 서명자 `verify` | `{session_token,expires_at}` |
| 서명자 `complete` | `{status,signed_at,employee_id}` |
| 증명서 `summary` | `{status,company_name,employee_name(마스킹),title,issue_number,issued_at,token_expires_at}` |

## 급여 도메인용 저장소 계약

급여는 `modules/hr/employees/employees.repository.ts`에서만 가져다 씁니다. 날짜 인자는 `PlainDate`(`YYYY-MM-DD`)입니다.

```ts
findEmployee(db, companyId: string, employeeId: number, today: PlainDate): EmployeeRecord | undefined
listEmployees(db, companyId: string, today: PlainDate, kinds?: readonly EmployeeKind[]): EmployeeRecord[]
listEmployeesEmployedBetween(db, companyId: string, from: PlainDate, to: PlainDate, kinds?: readonly EmployeeKind[]): EmployeeRecord[]
getEmployeeStatusAsOf(db, companyId: string, employeeId: number, date: PlainDate): 'PRE_JOINED' | 'JOINED' | 'LEAVE' | 'RESIGNED' | undefined
revealRegistrationNumber(db, cipher, companyId: string, employeeId: number): string | null
findWorkContractAsOf(db, companyId: string, employeeId: number, date: PlainDate): WorkContractRow | undefined
listWorkContracts(db, companyId: string, employeeId: number): WorkContractRow[]
findPayrollContractAsOf(db, cipher, companyId: string, employeeId: number, date: PlainDate): PayrollContractRecord | undefined
findDeductionInfoAsOf(db, companyId: string, employeeId: number, date: PlainDate): DeductionInfoRow | undefined
findSocialInsuranceAsOf(db, companyId: string, employeeId: number, date: PlainDate): SocialInsuranceRow | undefined
countDependantsAsOf(db, companyId: string, employeeId: number, date: PlainDate): DependantCounts
listLeavesOverlapping(db, companyId: string, employeeId: number, from: PlainDate, to: PlainDate): LeaveRow[]
findRetirementInfo(db, companyId: string, employeeId: number): RetirementInfoRow | undefined
setSeveranceSettlementStatus(db, companyId: string, employeeId: number, status: 'in_progress' | 'completed' | 'excluded' | null, now: string): boolean
toEmploymentType(kind) / fromEmploymentType(type)
CONTRACT_EXPIRY_WARNING_DAYS = 30
```

- `findPayrollContractAsOf`는 계좌번호를 복호화한 `account_number`와 파싱한 `payment_items`를 돌려줍니다.
- `setSeveranceSettlementStatus('completed')`가 되면 직원 삭제와 퇴직 정보 삭제가 막힙니다.

## 메뉴

| 코드 | 경로 | 조건 |
| --- | --- | --- |
| `employee_management` | `/employment` | 세무 플랜, 권한 필요. 급여 구독이면 메뉴 트리에서 숨김 |
| `employment_employee` | `/employee` | 급여 플랜, 권한 필요 |
| `employment_e_sign` | `/e-signature` | 급여 플랜, 권한 필요 |
| `employment_certificate` | `/certificate-issuance` | 급여 플랜, 권한 필요 |
| `settings_e_sign` | `/e-signature-setting/e-signature-templates` | 급여 플랜, 권한 필요 |
| `document_form` | `/document/document-form-list` | 전체, 권한 불필요 |

`default-menu-tree.ts`에 추가하거나 고칠 leaf입니다(이 브랜치에서는 수정하지 않음).

- 인사(411) `직원 관리`: `to`를 `/employee`에서 `/employment`로 변경
- 인사 그룹에 추가: `구성원 정보`(`employment_employee`, `/employee`), `전자서명`(`employment_e_sign`, `/e-signature`), `제증명 발급`(`employment_certificate`, `/certificate-issuance`)
- 설정 영역에 추가: `전자서명·제증명 관리`(`settings_e_sign`, `/e-signature-setting/e-signature-templates`)
- 서식·증명서 영역에 추가: `서식 모음`(`document_form`, `/document/document-form-list`)
- 급여 구독 시 `employee_management` 숨김 규칙(`MENU_EXCLUSION_RULES`)

## 시드

`hr.seed.ts`가 `c-corp`에 부서 3개, 직위 4개, 직원 4명을 넣습니다. 날짜는 시드 시각을 기준으로 잡아서 언제 시드해도 상태가 유지됩니다.

- 김민준: 정규직, 근로·급여계약 있음, 초안 전자서명 요청 1건
- 이서연: 육아휴직 중
- 박지훈: 2025-12-31 퇴사
- 최유진: 기간제, 계약이 20일 뒤 만료

시드는 바깥 트랜잭션 안에서 저장소 함수를 직접 호출하고 파일 블롭은 쓰지 않습니다.

## 열린 질문

- 레거시 직원 관리의 등록·수정 API는 리포트 앱 번들에 있어 확인하지 못했습니다. 목록과 퇴사 사유만 구현했습니다.
- 4대보험 신고 처리(`done`/`failed`) API와 담당자 화면은 어느 도메인이 맡을지 정해야 합니다.
- R10 고정수당 배율, 고용보험 상호주의 국가 목록, 서명 기한(16일)과 계약 만료 경고(30일), 육아휴직 한도(365일)는 실제 제품 값을 확인해야 합니다.
- 메뉴 코드 `employment_*`, `settings_e_sign`은 추정 이름입니다.
- 전자서명 완료 처리(`e-sign-completion.ts`)에 `contracts.service`의 `toWorkContractWrite`/`toPayrollContractWrite`와 겹치는 빌더가 있습니다. 규칙이 갈라지지 않게 하나로 합쳐야 합니다.
- `expireOverdueESignRequests`를 스케줄 배치(`scripts/schedule-filings.ts`)에 등록해야 합니다. 이 브랜치의 소유 범위 밖이라 등록하지 않았습니다.
- `ENCRYPTION_KEY`를 교체하는 절차에 `hr_secrets` 재암호화를 넣어야 합니다.
