# 인사(HR) 도메인 백엔드 스펙 노트

> 대상: 구성원 정보(신규), 직원 관리(레거시), 전자서명, 제증명 발급, 전자서명·제증명 설정, 서식 모음, 근로자용 서명·증명서 공개 플로우.
> 근거 표기: **M** = 매뉴얼(`alfred-manual/...`), **B:줄** = `app-alfred-kr/reverse/index.pretty.js` 줄 번호, **S** = 매뉴얼 스크린샷(`alfred-manual/images/...`), **추정** = 근거 없이 추론, **법령** = 법령·공단 규정 근거.
> 와이어 규약은 `docs/tax-api-design.md` 1.4–1.5를 따릅니다: snake_case, 경로 끝 슬래시, DRF 페이지네이션 `{count,next,previous,results}`, `?limit=&offset=`, 회사 단위 JWT. 페이지 컴포넌트는 lazy chunk라 번들에 없으므로 **응답 형태는 대부분 추정**입니다.

---

## 0. 한눈에 보기

- 백엔드는 `sf-api` 하나입니다. 예외로 서식 모음(`/nexus-api/document-form*`)도 sf 클라이언트(`getApi$2.document`, B:73201-73208)로 호출하지만 경로가 `/nexus-api/` prefix를 씁니다. 즉 `https://sf-api.alfred.kr/nexus-api/document-form` 입니다(axios 절대경로 + baseURL).
- 인사 API는 두 세대가 공존합니다.
  - **레거시** `GET /api/company/:id/employee/`(B:73229-73236): 세무 기장 고객의 "직원 관리"가 씁니다. 화면은 레거시 리포트 앱 `/employment:postUrl(.*)`(`reportEntryPoint: "new-employment"`, routes.tsv:23, B:102687)입니다. 레거시 앱이 쓰는 나머지 API는 번들 밖에 있습니다.
  - **신규** `/api/company/:id/employment/*`(B:73400-74643): 급여 구독 고객의 "구성원 정보", "전자서명", "제증명 발급", "전자서명·제증명 관리"가 씁니다.
- 근로자(서명자)는 로그인하지 않습니다. `/api/employment/e-sign/:token/*`와 `/api/employment/certificates/:token/*`가 토큰과 `X-ESign-Session` 헤더(B:74481)로 인증합니다.
- 소득 유형별 직원 종류는 4가지입니다(`EmployeeKind`, B:73218-73225): `wage-salary`(근로소득), `daily`(일용), `business`(사업소득), `other`(기타소득). 전체 CRUD와 하위 리소스는 `wage-employees`만 갖습니다. `daily/business/other-employees`는 번들에 `PATCH`만 있습니다.
- 범위에 든 엔드포인트는 **고유 경로 67개, 메서드 단위 101개**입니다([5장](#5-엔드포인트-표)).

---

## 1. 화면과 흐름

### 1.1 메뉴 노출 규칙

| 메뉴 | 라우트 | 노출 조건 | 근거 |
| --- | --- | --- | --- |
| 인사 > 구성원 정보 | `/employee`, `/employee/:id(\d+)` (`EmploymentEmployee`, `EmploymentEmployeeDetail`) | 급여 구독(`subscriptions[].code === "payroll"`). 급여 구독과 세무 기장을 함께 쓰는 회사도 포함 | M `04-인사/02-구성원-정보.md`, M `09-...메뉴-구조.md`, B:72531, B:102575-102577 |
| 인사 > 직원 관리 (레거시) | `/employment:postUrl(.*)` (리포트 앱 `new-employment`) | 세무 기장 고객. **급여 구독이면 숨김**: `MENU_EXCLUSION_RULES`의 `{codes:["employee_management"], when: company.hasPayrollPlan}` | M `04-인사/01-직원-관리.md`, B:77551, B:88448 |
| 인사 > 전자서명 | `/e-signature`, `/e-signature/issue`, `/e-signature/:id(\d+)` | 급여 구독 | M `04-인사/03-전자서명.md`, B:103870, B:104228-104253 |
| 인사 > 제증명 발급 | `/certificate-issuance`, `/certificate-issuance/create`, `/certificate-issuance/:id(\d+)` | 급여 구독 | M `04-인사/README.md`, B:103950, B:104254-104280 |
| 설정 > 전자서명·제증명 관리 | `/e-signature-setting/e-signature-templates`, `/e-signature-setting/company-seals`, `/e-signature-setting/e-signature-templates/:id` | 급여 구독 | M `08-설정/05-...`, B:103883-103912, B:104215 |
| 서식·증명서 > 서식 모음 | `/document/document-form-list` (`Report-Document-Form`) | 전체(구독 무관) | M `07-서식·증명서/01-서식-모음/README.md`, B:103083 |
| 서식·증명서 > 증명서 발급 | `/document/certificate/request-history` (리포트 앱 `document`) | 세무 구독. **세무 증명서**이고 인사 제증명과 다른 기능이라 이 노트의 범위 밖 | M `07-서식·증명서/02-증명서-발급.md`, routes.tsv:22 |
| 근로자 서명 | `/e-signature/worker/:signingToken/{verify-identity, documents/:documentIndex, complete, cancelled, expired, invalid}` | 공개(`isPublic`, `companyNotRequired`) | B:104371-104445 |
| 근로자 증명서 수령 | `/certificates/worker/:signingToken/{verify-identity, complete, expired, invalid}` | 공개 | B:104447-104505 |

- 메뉴 코드 중 번들에서 확인된 것은 `employee_management`(레거시 직원 관리, B:77551)뿐입니다. 프로모션 노드 필터에는 `pb_employment`, `pb_payroll_management`(B:77615)가 나오는데, 이 둘은 HQ 에이전시이거나 무료 회사일 때만 보입니다. 구성원 정보·전자서명·제증명의 메뉴 코드는 **미확인**입니다. 추정 이름은 `employment_employee`, `employment_e_sign`, `employment_certificate`, `settings_e_sign`입니다.
- `/employee`와 `/e-signature` 계열 라우트는 `requiresMenuAccess: true`인 레이아웃(B:102607) 아래에 있어서, 클라이언트 가드가 3뎁스 메뉴와 매칭합니다.
- UTM 업셀 매핑에서 `employeeManagement`는 `/employment`, campaign은 `heum_upgrade_hrm`입니다(B:88353, B:88448).

### 1.2 구성원 정보 목록 (`/employee`)

S `ad4ecc0b8875be56dc44`

- **탭(상태 카운트)**: 전체 / 재직 / 휴직 / 퇴직 → `GET wage-employees/count-by-status/`
- **필터**: "현재 근무자만 보기" 체크박스(추정: `EMPLOYEE_STATUS.WORKING`), 검색(이름·부서·직위), 정렬(이름·상태·생년월일·입사일·부서·직위), 페이지 크기 20.
- **컬럼**: 이름(+경고 아이콘 ▲), 상태, 생년월일, 입사일, 부서, 직위, 케밥 메뉴.
  - 경고 아이콘은 계약 만료 임박·만료, 필수 정보 누락, 무기계약 전환 대상 중 하나로 **추정**합니다. 근거는 `CONTRACT_FILTER {expiring_soon, expired}`(B:73476)와 `contract-expiry-alert`(B:73501)입니다.
- **상단 버튼**: `부서/직위 설정`(모달, `departments/bulk`, `positions/bulk`), `구성원 등록하기`(모달).
- **엑셀 내보내기**: `GET wage-employees/export/`(blob).
- **계약 만료 배너(추정)**: `GET wage-employees/contract-expiry-alert/`.
- 권한: 회사 사용자 중 해당 메뉴 권한이 있는 사람. 데모 사용자는 클라이언트 목업을 씁니다(레거시 `employee.getEmployee`만 목업 있음, B:75984-75997).

### 1.3 구성원 등록 모달

S `48078f18e6bff2ae5e05`, M `02-구성원-정보.md` "2) 구성원 등록하기"

- 필수: 성명, 주민등록번호, 입사일자.
- 선택: 내외국인 구분(내국인/외국인), 담당업무(4대보험 직종코드 셀렉트), 이메일, 부서, 직위.
- `POST wage-employees/` → 중복이면 `DUPLICATE_EMPLOYEE`(B:73510).
- 외국인이면 식별번호 유형 `registration | passport`(`IDENTIFICATION_NUMBER_TYPE`, B:73504)를 받습니다(추정: 외국인등록번호 또는 여권번호).
- 처음 가입할 때 ERP(더존, 세무사랑)에 있던 구성원은 자동 등록됩니다. 레거시 직원 관리에서는 "임시저장" 상태로 들어옵니다(M `01-직원-관리.md`).

### 1.4 구성원 상세 (`/employee/:id`)

S `46695140...`, `5f08b27a...`, `49a1df34...`, `fb75b3fa...`, `5a499f52...`, `c97eeba3...`, `32043b25...`

헤더에는 이름, 상태 배지(재직 등), "부서 · 직위", 케밥(삭제 추정)이 있습니다. 좌측 탭 5개와 좌하단 "특이사항"(메모)으로 구성됩니다.

| 탭 | 섹션 | API (추정 매핑) |
| --- | --- | --- |
| 기본 정보 | 성명*, 이메일, 내외국인, 주민등록번호*, 현재 거주국가, 사번, 부서, 직위 | `GET/PATCH wage-employees/:id/` + `GET/PUT .../common-info/` |
| | 퇴직금/퇴직연금 유형(퇴직금·DB·DC), 퇴직금/퇴직연금 중도정산(예/아니오) | `.../retirement-info/` |
| | 인적공제 대상자(목록 + 등록 모달) | `.../family-members/*` |
| | 인사 변동 정보 → [등록하기 ▼ 휴직 / 퇴직] | 휴직: `.../leave-of-absences/*`. 퇴직: `PUT/DELETE .../retirement-info/` |
| 근로계약 정보 | ① 근로 정보: 입사일*, 담당업무(직종코드), 계약형태(정규직/계약직), 근로계약 시작일(·종료일), 근로형태(일반근로 등), 근로조건(정책 선택), 수습기간(적용/미적용), 근로시간(정책 선택) | `.../work-contracts/*` |
| | ② 기본 급여조건: 임금지급시기(당월/익월 + 일자, "31일(말일)"), 임금지급방법(계좌이체/직접지급) + 계좌(은행, 계좌번호, 예금주) | work-contract 또는 payroll-contract (**미확인**) |
| | ③ 계약된 급여정보: 임금 산정 방식(월급/일급/시급), 월 소정근로시간(불러오기/직접입력), 급여액, 기준시급, 수습기간 기준시급, 통상시급, 지급항목(토글 + 금액), 고정임금제 항목(자동계산, 고정 연장·야간·휴일·휴일연장 근로 시간·금액), 연봉, 상여금(지급/미지급, 금액, 통상시급 포함 여부) | `.../payroll-contracts/*` |
| 4대보험 정보 | ① 기초조사(대표자/임원, 대표자와 동거 친족, 독립·국가유공자, 비상근), ② 4대보험 가입 여부 4종 + "국민연금 취득월 납부 희망", ③ 두루누리 적용 여부 | `GET/PUT .../social-insurance-info/`, `POST .../preview/`, `GET .../redetermine/` |
| 소득세 및 기타공제 정보 | 근로소득세 산출방법(간이세액표/직접입력), 소득세액 조정비율(80/100/120%), 소득세 감면제도(+감면기간·감면율·감면 적용부분), 감면 적용 방식(매달 급여/연말정산), 공제대상 가족(읽기 전용, 인적공제 대상자에서 자동 계산: 본인 포함 전체 수, 8~20세 자녀 수), 학자금대출 상환(신청/미신청, 월 공제액, 공제기간) | `GET/PUT .../deduction-info/`, `GET wage-employees/income-tax-reduction-reasons/` |
| 문서 보관함 | 카테고리별 업로드: 계약서 / 증명서 / 동의서 / 사직서 / 기타. PDF·JPEG·PNG, 파일당 10MB | `.../documents/*`, 카테고리 목록은 `settings/document-categories/` |
| 특이사항 | 자유 텍스트 메모 + 변경 이력 | `GET/PUT/DELETE .../memo/`, `GET .../memo-histories` |

**휴직 등록 모달** (S `9b71bd0b8b3324567260`): 성명(읽기 전용), 휴직사유(출산·육아·질병·기타. 화면 표기는 "육아휴직"), 휴직 시작일, 휴직 종료일, 복직 예정일, 유급휴직 토글과 유급휴직 수당(원), 근속연수 포함(육아휴직이면 자동 on, 비활성), 국민연금 납부예외 토글, 건강보험 납입고지유예 토글(1개월 이상 휴직일 때만). 저장한 내용으로 **4대보험 휴직 신고**가 진행됩니다(M).

**퇴직 정보 모달** (S `cdedc3a7a9fb74287715`): 성명, 퇴직사유, 퇴직상세사유, 퇴직일("계약 종료일을 선택해 주세요" 힌트), 퇴직금(선택, 원), [삭제]/[저장]. 고른 사유는 **상실신고에도 같은 값으로** 들어갑니다(M).

**인적공제 대상자 모달** (S `5ebe2bb8ae8030378348`): 성명*, 생년월일*, 근로자와의 관계*(`RELATION`), 내외국인*, 공제 종류*(비과세 대상자 / 연말정산 대상자 / 피부양자 등록, 복수 체크. "비과세 대상자"는 조건부 비활성).

### 1.5 레거시 직원 관리 (`/employment`, 리포트 앱)

S `6946bbe2d69c51442849`, `5a2f5c3b2456cc3b1bd6`, `fdf5ee19e9fcc2e0129b`

- 좌측 상태 카운트(재직자 / 휴직자 / 퇴사자 / 신청중 / 임시저장), 이름 검색, 컬럼(이름·상태·관리[수정/삭제]), `직원 등록` 버튼이 있습니다.
- 상세 폼: 과세수당(상여, 교통비, 성과급, 인센티브, 자격수당…, 추가 가능), 비과세수당(식대, 연구수당, 육아수당, 차량유지비, 학자금지원, 추가 가능), 총 급여액(= 기본급 + 과세수당 합계 + 비과세수당 합계), 피부양자 및 부양가족, 학자금대출상환, 4대보험 설계(제외대상), [임시저장] / [직원정보 등록하기].
- "신청중"은 `EmploymentStatus`의 `입사처리중 / 퇴사처리중 / 휴직처리중`에 해당합니다. 세무 담당자가 4대보험 신고를 처리하는 중이라는 뜻입니다(추정, 아래 `employee_work` 참고).
- 번들에서 확인되는 API는 `GET employee/`(목록, `simple=True|False`)와 `GET employee/leaving-reason/`뿐입니다. 등록·수정은 리포트 앱 번들에 있어 **미확인**입니다.

### 1.6 전자서명 목록 (`/e-signature`)

S `ac2def5e8f9ad73a4a71`(배경), `3af3cc7eb695555fc7b7`

- 필터: 기간 조회 유형(셀렉트, 추정 `requested_at | signed_at`), 기간(일간 범위), 상태, 카테고리, 구성원명, 검색(전자문서명·부서명).
- 컬럼: no., 수신자(이름 + 이메일), 부서명, 카테고리, 문서명(추정), 요청/수정 일시, 상태(+보조 문구), 액션.
- 상태별 액션(S `3af3cc7e...`):

| 표시 | 상태 값 | 보조 문구 | 액션 |
| --- | --- | --- | --- |
| 발송전(임시저장) | `draft` | – | 삭제, 작성하기 |
| 서명 전 | `pending` | 서명 기한 D-16(2026.07.09) | 요청 취소 |
| 서명 중 | `in_progress` | 서명 기한 D-2 | (없음) |
| 완료 | `completed` | 서명 일시 2026.06.08 11:26 | 다운로드(PDF) |
| 기한만료 | `expired` | 만료 일시 2026.06.14 00:00 | 삭제, 재발송 |
| (미표시) | `cancelled`, `voided`, `send_failed` | – | 추정: 재작성(revert-to-draft), 삭제 |

- 상단: `알림 설정`(모달), `전자 서명 발급`(→ `/e-signature/issue`).
- 알림 설정 모달: 수신 정보 행 [추가 +], 각 행은 성명*, 직위(셀렉트), 전화번호*, 이메일입니다. **최대 3명**이고, 설정하지 않으면 **대표자 연락처**가 기본값입니다. 채널은 **카카오 알림톡**이고 완료·기한 만료 이벤트에 보냅니다(M `03-전자서명.md`).
- 서명이 진행 중이거나 끝난 문서는 수정·삭제할 수 없습니다(M).

### 1.7 전자서명 발급 (`/e-signature/issue`, `/e-signature/:id`)

S `c9418d33...`, `f5105c22...`, `6c0beead...`, `371b9d5f...`, `f9cda41c...`, `0c50f7a0...`, `29839cfc...`

1. **문서 설정(1단계)**
   - 전자 문서 종류*(템플릿 선택). 매뉴얼 목록은 근로계약서, 근로계약서(일용직), 연봉계약서, 용역계약서, 개인정보처리방침(동의서), 비밀유지서약서(동의서), 사직서입니다.
   - 전자 문서 첨부(다른 템플릿을 함께 묶음. 추정: 한 요청에 문서 여러 개 → 근로자 라우트 `documents/:documentIndex`).
   - 5인 미만 사업장 여부*(5인 이상 / 5인 미만. 대표자·임원을 뺀 상시 근로자 수 기준). 이 값으로 템플릿 변형을 고릅니다(예: "근로계약서(정규직, 5인이상)").
   - 수신자 정보: 성명*, 이메일, 내외국인*, [구성원에서 찾기]. 외국인이면 **국적과 체류자격이 필수**입니다.
2. **수신자별 문서 작성(2단계)**: 좌측 패널에 수신자(신규/기존 배지), 이메일, 계약 설정(임금 산정 방식, 근로조건 [불러오기], 근로시간 정책 [불러오기])이 있습니다. 근로조건과 근로시간 정책은 설정 > 급여 설정 값을 씁니다(급여 노트 범위). 본문은 템플릿 필드(입력란)를 채우는 방식입니다.
   - 필드 예: 구성원 입사일, 급여계약 시작일/종료일, 수습기간 개월수, 수습기간 지급률, 근무장소(근로조건에서 자동), 업무내용, 근무 형태(선택적근무제 등), 1일·1주 소정근로시간, 임금표.
   - 조항마다 [표시/숨김] 토글이 있고, 숨긴 지급항목은 최저임금 계산에서 빠집니다.
   - 임금표: 월급여(필수) + 월 소정근로시간, 기본급(자동계산), 지급항목들. **법정 최저시급 미달이면 경고**하고 진행을 막습니다(추정).
   - 하단 진행 바: "1/3 페이지", "다음 입력란 10/16", 미리보기, 입력 완료.
   - [임시저장]을 누르지 않고 나가면 작성 내용이 사라집니다. 저장 시점은 명시적 임시저장뿐입니다.
3. **요청**: 필수 필드를 다 채우면 [전자 서명 요청]이 활성화됩니다. 이메일 확인 모달이 뜨고(이메일 필수), 발송하면 "YYYY.MM.DD까지 서명을 완료해 주세요"와 함께 발송한 이메일을 보여 줍니다. 서명 기한은 발송일 + N일입니다. 예시에서는 2026.06.23 → 2026.07.09로 약 16일이라 **N은 미확인**입니다.

### 1.8 근로자 서명 플로우 (공개)

B:74481-74513, routes.tsv:175-182

```text
메일/알림톡 링크 → /e-signature/worker/:signingToken
  GET  summary/                         → 회사명·문서 목록·만료 여부 (상태가 cancelled/expired/invalid면 해당 화면으로)
  POST verify/  {본인확인 값}            → 세션 토큰 발급 (이후 X-ESign-Session 헤더)
  GET  documents/        [session]      → 서명할 문서들(렌더링 데이터, 근로자 입력 필드)
  GET  seals/            [session]      → 근로자가 이미 만든 서명 이미지
  POST seals/ (multipart)[session]      → 서명 이미지 등록
  GET  leaving-reasons/  [session]      → 사직서일 때 퇴직 사유 선택지
  POST complete/         [session]      → 서명 데이터 제출 → 요청 completed
  GET  download/         [session]      → 서명 완료 PDF (blob)
```

### 1.9 제증명 발급 (`/certificate-issuance`)

- 발급 대상 문서: 표준 취업 규칙, 경력증명서, 재직증명서, 퇴직증명서(M `09-...메뉴-구조.md`). 템플릿은 전자서명과 같은 "전자서명 템플릿" 저장소를 씁니다(M `08-설정/05`: "전자서명 및 구성원 제증명 발급에 사용").
- 목록: 상태 카운트 탭(`count-by-status`), 목록, 상세, 삭제, 일괄 다운로드(`POST download/` → blob, 선택한 id 목록 추정).
- 발급(`/certificate-issuance/create`): 구성원 선택, 문서 종류, 필드 입력(용도·제출처 추정), 회사 도장 → `POST certificates/` → `issued`.
- 발송: `POST certificates/:id/send/`(body 생략 가능, 추정: 수신 이메일·전화 override) → `sending` → `sent | send_failed`.
- 근로자 수령: `/certificates/worker/:signingToken` → `summary` → `verify` → `download`(세션 헤더).

### 1.10 전자서명·제증명 관리 (설정)

S `36d62eff6128aa023e4a`, `c4e43628a98c5ea32247`, M `08-설정/05-...`, M `04-인사/03-전자서명.md` "최초 설정"

- **전자서명 템플릿 탭**: 검색(전자 문서명), 컬럼(카테고리, 제목, 수정자, 수정일시), 행마다 [사용 관리] 토글(비활성화)이 있습니다. 행을 클릭하면 `/e-signature-setting/e-signature-templates/:id`에서 기본값을 편집하고, 하단 **대표자 이름 옆 도장·사인을 지정**해 저장합니다.
  - 제공 템플릿 예: 근로계약서(계약직/정규직 × 5인미만/5인이상), 단시간 근로자 근로계약서(계약직/정규직 × 5인 미만/이상), 연봉계약서(계약직/정규직)…
- **도장·사인 관리 탭**: 최대 5개. [서명 업로드](이미지 파일) / [사인 만들기](캔버스로 그려 이미지로 업로드). 카드마다 이미지와 "작성자 {email} · {date}"를 보여 줍니다. 삭제할 수 있습니다.

### 1.11 서식 모음 (`/document/document-form-list`)

- 무료 서식 목록과 다운로드. 카테고리는 인사, 경리, 부동산, 주식, 이사회, 일반계약입니다(M `01-서식-모음/README.md`, 39종).
- `GET /nexus-api/document-form?{params}`(목록), `GET /nexus-api/document-form/type-count?{params}`(카테고리별 개수).

---

## 2. 엔티티와 필드

> 타입 표기: `int`, `text`, `date`(YYYY-MM-DD), `datetime`(ISO), `bool`, `money`(원 단위 정수), `decimal`, `fk→`, `enum`. **출처 열이 "추정"이면 응답 필드명까지 추정**입니다.

### 2.1 Employee 공통 (Person) — 종류 구분

| 필드 | 타입 | 의미 | 허용 값 | 출처 |
| --- | --- | --- | --- | --- |
| `id` | int | 직원 ID (종류별 테이블 PK로 추정) | | B:75345 목업 |
| `company` | fk→company | sf 회사 | | B:75346 |
| `kind` | enum | 소득 유형 | `wage-salary`, `daily`, `business`, `other` | B:73218-73225 |
| `name` | text | 성명 | 필수 | S, B |
| `english_name` | text | 영문 성명 | | B:75366 |
| `registration_number` | text | 주민등록번호 / 외국인등록번호 (암호화 저장 필요) | 13자리 | B:75351, S |
| `identification_number_type` | enum | 식별번호 유형 | `registration`, `passport` | B:73504 (필드명 추정) |
| `email` | text | 이메일 (전자서명·증명서 발송 기본값) | | S |
| `is_local` | bool | 내국인 여부 | | B:75369 |
| `nationality` | text | 국적 (외국인 필수, 국가코드 추정) | | B:75370, M 전자서명 |
| `visa` | text | 체류자격 (외국인 필수, 예: E-9) | | B:75371 |
| `is_residence` | bool | 거주자 여부 | | B:75372 |
| `country_of_residence` | text | 현재 거주국가 | 기본 "대한민국" | B:75373, S |

> 전자서명에서 수신자를 가리키는 키는 Django ContentType 모델명 `wageemployee | dailyemployee | businessemployee | otheremployee`(`E_SIGN_EMPLOYMENT_TYPE`, B:74530)입니다. 즉 현행 서버는 **종류별 테이블 4개 + generic FK** 구조입니다. 새 설계에서는 `employees(kind)` 단일 테이블에 종류별 확장 테이블을 붙이는 쪽을 권장합니다. 단 와이어에서는 위 4값을 `employment_type`으로 받아야 합니다.

### 2.2 WageEmployee (근로소득자, 구성원 정보의 주 엔티티)

| 필드 | 타입 | 의미 | 허용 값 | 출처 |
| --- | --- | --- | --- | --- |
| `status` | enum | 재직 상태 | `PRE_JOINED`, `WORKING`, `JOINED`, `LEAVE`, `RESIGNED` (쿼리 파라미터는 1–5 정수) | B:73462-73475 |
| `employee_number` | text | 사번 | | S `46695140` (필드명 추정) |
| `department` | fk→department, null | 부서 | | S, B:73585 |
| `position` | fk→position, null | 직위 | | S |
| `join_date` | date | 입사일 | 필수 | S, `EMPLOYEES_DATE_TYPE.JOIN_DATE` B:73477 |
| `leave_date` | date, null | 퇴직일 | | `EMPLOYEES_DATE_TYPE.LEAVE_DATE` |
| `birth_date` | date | 생년월일 (주민번호에서 파생 가능) | | `EMPLOYEES_DATE_TYPE.BIRTH_DATE`, S 목록 |
| `work_code` | text | 담당업무 = 4대보험 직종코드 (예: `415` 디자이너) | 직종코드표 | S `fb75b3fa`, B:75379 (레거시 `workCode`) |
| `contract_type` | enum | 현재 계약 형태 요약 | `regular`, `contract`, `none` | `CONTRACT_TYPE_RESPONSE` B:73483 |
| `contract_end_date` | date, null | 현재 계약 종료일 (목록 경고용) | | 레거시 `contractEndDate` B:75377 |
| `has_warning` | bool | 목록 ▲ 아이콘 | | S (추정) |
| `created`, `updated` | datetime | | | B:75426 |

**목록 쿼리 파라미터(추정, 상수 근거)**: `status`(1–5, 콤마 구분. sf 클라이언트는 `arrayFormat: comma`), `search`, `ordering`, `date_type`(`join_date | leave_date | birth_date`) + `start_date`/`end_date`, `contract_filter`(`expiring_soon | expired`), `limit`, `offset`.

### 2.3 레거시 Employee (`GET employee/`)

데모 목업 `createEmployee`(B:75356-75427)와 `createSimpleEmployee`(B:75343-75354)가 응답 형태를 보여 줍니다. `simple=True`이면 `{id, company, name, employment_status, join_date, leave_date, registration_number, kind, email}`만 돌려줍니다.

| 필드 | 타입 | 의미 |
| --- | --- | --- |
| `duzon_code` | text | 더존 ERP 사원코드 |
| `company` | object | `{id, name, kind{value,display}, is_corporation_tax, business_number, membership_set, is_settlement_target}` |
| `employment_status` | enum(한글) | `재직, 휴직, 퇴사, 임시저장, 입사처리중, 퇴사처리중, 휴직처리중` (B:73209-73217) |
| `is_contract_worker`, `contract_end_date` | bool, date | 계약직 여부와 종료일 |
| `weekly_work_time` | number | 주 소정근로시간 |
| `work_code` | text | 직종코드 |
| `is_rejoin` | bool | 재입사 여부 |
| `leave_of_absence` | array | 휴직 이력 |
| `retirement_reason`, `retirement_detail_reason` | text | 퇴직(상실) 사유 코드와 상세 |
| `retirement_pension_type` | enum, null | 퇴직연금 유형 |
| `retirement_grants` | money | 퇴직금 |
| `paid_retirement_grants`, `is_interim_retirement_grants` | bool | 퇴직금 지급 여부, 중간정산 여부 |
| `family`, `family_count` | array, int | 부양가족 |
| `is_temp_save` | bool | 임시저장 |
| `info`, `initial_payroll` | object | 자유 구조(급여 초기값: 과세·비과세 수당 등) |
| `employee_work` | object | **4대보험·ERP 처리 작업 상태**. `is_{join,leave,dependent,leave_of_absence,reinstatement}_work`, `*_work_result`, `*_work_result_msg`, `*_work_time`, `is_duzon_input`, `duzon_input_request_time`, `duzon_input_result(_msg/_time)`, `is_duzon_input_init` |

> 설계 시사점: `employee_work`는 "취득·상실·피부양자·휴직·복직 신고"와 "더존 입력"을 작업 단위로 추적합니다. 신규 설계에서는 `insurance_filings(employee_id, kind: join|leave|dependent|leave_of_absence|reinstatement, status, result_msg, requested_at, processed_at)` 테이블로 정규화하는 것을 권장합니다. 레거시 상태 "○○처리중"은 이 작업이 열려 있는 상태에서 계산되는 값입니다.

### 2.4 Daily / Business / Other Employee

| 엔드포인트 | 번들 | 비고 |
| --- | --- | --- |
| `PATCH employment/daily-employees/:id/` | B:74418 | 일용근로자. 생성·조회는 급여 정산 카드(`payroll/bpo/card/*`, 급여 노트)에서 하는 것으로 추정 |
| `PATCH employment/business-employees/:id/` | B:74415 | 사업소득자(프리랜서, 3.3%) |
| `PATCH employment/other-employees/:id/` | B:74421 | 기타소득자 |

필드는 **미확인**입니다. 2.1 공통 필드 + 계좌 + (사업소득자) 업종코드 정도로 추정합니다.

### 2.5 Department / Position

| 필드 | 타입 | 의미 | 출처 |
| --- | --- | --- | --- |
| `id` | int | | |
| `name` | text | 부서명 / 직위명 (회사 내 유니크 추정) | S `5b1de3f0` |
| `order` | int | 표시 순서 (추정) | |
| `is_used` / `deletable` | bool | 직원이 쓴 적 있으면 삭제 불가 | M "한 번 설정하여 사용된 부서 및 직위는 삭제할 수 없습니다" |

`POST departments/bulk/`, `POST positions/bulk/` body는 추정 `{items:[{id?, name}]}`입니다. 목록 전체를 교체하는 방식으로, 빠진 id는 삭제하고 사용 중인 id가 빠지면 400을 돌려줍니다.

### 2.6 FamilyMember (인적공제 대상자)

| 필드 | 타입 | 의미 | 허용 값 | 출처 |
| --- | --- | --- | --- | --- |
| `id` | int | | | |
| `name` | text | 성명 | 필수 | S `5ebe2bb8` |
| `birth_date` | date | 생년월일 | 필수 | S |
| `relation` | enum(한글) | 근로자와의 관계 | `부모, 조부모, (시/처)조부모, 증조부모, (시/처)증조부모, 처부모, 시부모, 배우자, 자녀, 사위_자부, 손자녀, 증손자녀, 형제_자매, 기타, 해당없음` | B:73600-73616 |
| `is_local` | bool | 내외국인 | | S |
| `registration_number` | text | 주민번호 (연말정산·피부양자 신고에 필요, 추정) | | 추정 |
| `is_tax_free_target` | bool | 비과세 대상자 (육아·보육수당 지급 대상: 6세 이하 자녀) | | S, M |
| `is_year_end_target` | bool | 연말정산(기본공제) 대상자 | | S |
| `year_end_dependant_type` | enum(한글) | 연말정산 공제 구분 | `대상자아님, 배우자, 20세_이하, 60세_이상, 장애인, 기초생활대상자, 자녀_장려금_수급자` | B:73617-73625 |
| `is_health_insurance_dependent` | bool | 건강보험 피부양자 등록 | | S → 피부양자 취득 신고 트리거(추정) |
| `attachments[]` | FamilyAttachment | 증빙 파일 (가족관계증명서 등) | | B:73649-73665 |

**FamilyAttachment**: `id`, `file`(multipart), `file_name`, `mime_type`, `created`(추정). `PATCH`도 multipart이므로 파일 교체가 됩니다.

### 2.7 LeaveOfAbsence (휴직)

| 필드 | 타입 | 의미 | 허용 값 | 출처 |
| --- | --- | --- | --- | --- |
| `id` | int | | | |
| `reason` | enum | 휴직사유 | `maternity`(출산전후휴가), `parental`(육아휴직), `illness`(질병), `etc` | M (값 문자열은 추정) |
| `start_date`, `end_date` | date | 휴직 기간 | `start ≤ end` | S |
| `expected_return_date` | date | 복직 예정일 | 보통 `end_date + 1` | S |
| `actual_return_date` | date, null | 실제 복직일 (복직 처리) | | 추정 |
| `is_paid` | bool | 유급휴직 | | S |
| `paid_allowance` | money | 유급휴직 수당 (`is_paid`이면 필수) | | S, M |
| `include_in_service_years` | bool | 근속연수 포함 (육아휴직이면 강제 true) | | S, **법령**(남녀고용평등법 제19조 ④) |
| `nps_payment_exception` | bool | 국민연금 납부예외 신청 | | S |
| `nhis_notice_deferral` | bool | 건강보험 납입고지유예 (1개월 이상일 때만) | | S |
| `filing_status` | enum | 4대보험 휴직 신고 처리 상태 | 추정 `pending|done|failed` | 레거시 `leave_of_absence_work_*` |

`GET leave-of-absence-info/`: 현재 휴직 상태 요약으로 추정합니다(진행 중인 휴직, 누적 휴직일, 육아휴직 잔여 등). 목록은 `?limit=&offset=` 페이지네이션입니다(B:73529-73535).

### 2.8 RetirementInfo (퇴직 / 퇴직급여 설정, 직원당 1개)

| 필드 | 타입 | 의미 | 허용 값 | 출처 |
| --- | --- | --- | --- | --- |
| `retirement_benefit_type` | enum | 퇴직금/퇴직연금 유형 | `grant`(퇴직금), `pension_db`, `pension_dc` | B:73834 |
| `has_interim_settlement` | bool | 중도(중간)정산 여부 | | S `5f08b27a` |
| `interim_settlement_date` | date, null | 중간정산 기준일 | | `LEAVE_DATE_BEFORE_INTERIM` B:73855 |
| `interim_settlement_reason` | enum | 중간정산 사유 | `home_purchase, rent_deposit, medical_treatment, bankruptcy, personal_rehabilitation, wage_peak, work_hours_reduction, legal_work_hours_reduction, etc_gov_notice` | B:73844, **법령**(근퇴법 시행령 제3조) |
| `leave_date` | date | 퇴직일 | `≥ interim_settlement_date` | S, B:73855 |
| `leaving_reason` | code | 퇴직(상실)사유 | 2.15 참조 | S `cdedc3a7` |
| `leaving_detail_reason` | code | 퇴직상세사유 | 상위 코드에 종속 | S |
| `severance_amount` | money, null | 퇴직금 (선택 입력) | | S |
| `severance_settlement_status` | enum | 퇴직금 정산 상태 | `in_progress, completed, excluded` | B:73839 |

- `PUT`은 퇴직 등록·수정, `DELETE`는 퇴직 취소입니다(재직으로 복귀).
- 퇴직금 정산이 완료된 직원은 삭제할 수 없습니다(`RETIREMENT_COMPLETED`, B:73511).

### 2.9 WorkContract (근로계약 — 근로 정보)

| 필드 | 타입 | 의미 | 허용 값 | 출처 |
| --- | --- | --- | --- | --- |
| `id` | int | | | |
| `creation_method` | enum | 생성 경로 | `esign`(전자서명 완료로 생성), `manual` | B:73456 |
| `e_sign_request` | fk, null | 원본 전자서명 요청 | | 추정 |
| `contract_type` | enum | 계약 형태 | `regular`(정규직), `contract`(계약직) | S, B:73483 |
| `start_date` | date | 근로계약 시작일 | | S |
| `end_date` | date, null | 계약 종료일 (`contract`이면 필수) | | 추정 |
| `status` | enum | 계약 상태 (날짜로 계산) | `scheduled`, `active`, `expired` | B:73457-73461 |
| `work_type` | enum | 근로형태 | `regular`(일반근로), `part_time`(단시간), `short_time`(초단시간, 추정) | B:73675-73679, S "일반근로" |
| `work_code` | text | 담당업무(직종코드) | | S |
| `work_condition` | fk→work_condition | 근로조건 정책 (근무장소·수습) | 급여 노트 | S, M |
| `has_probation` | bool | 수습기간 적용 | | S |
| `probation_months`, `probation_pay_rate` | int, decimal | 수습 개월수, 지급률(%) (근로조건에서 상속 추정) | 지급률 ≥ 90 | S `371b9d5f`, **법령**(최저임금법 제5조 ②) |
| `work_schedule_policy` | fk | 근로시간 정책 | 급여 노트 | S |
| `job_description` | text | 업무내용 | | S `371b9d5f` |
| `document` | fk→employee_document, null | 계약서 파일 | | 추정 |

목록 파라미터는 추정 `?status=` 또는 페이지네이션입니다. 계약 이력을 보관해 무기계약 전환 판정(4장)에 씁니다.

### 2.10 PayrollContract (계약된 급여정보 + 기본 급여조건)

| 필드 | 타입 | 의미 | 허용 값 | 출처 |
| --- | --- | --- | --- | --- |
| `id` | int | | | |
| `start_date`, `end_date` | date | 급여계약 기간 | | S `371b9d5f` "급여계약 시작일/종료일" |
| `wage_type` | enum | 임금 산정 방식 | `monthly`, `daily`, `hourly` | S, M (값은 추정. 급여 노트 `wage-monthly/daily/hourly` 경로와 정합) |
| `monthly_work_hours_source` | enum | 월 소정근로시간 출처 | `policy`(불러오기), `manual` | S `8407bb45` |
| `monthly_work_hours` | decimal | 월 소정근로시간 (예: 209) | | S |
| `daily_work_hours` | decimal | 일 근로시간 (일급) | | M |
| `amount` | money | 급여액 (월급/일급/시급) | | S |
| `base_hourly_wage` | decimal | 기준 시급 = 기본급 ÷ 월 소정근로시간 (서버 계산) | | S |
| `probation_hourly_wage` | decimal | 수습기간 기준 시급 | | S `7f698daa` |
| `ordinary_hourly_wage` | decimal | 통상시급 (서버 계산) | | S |
| `payment_items[]` | `{payment_item, is_enabled, amount}` | 지급항목 (회사 설정 `payroll-payment-items` 참조) | | S, M |
| `fixed_wage_auto_calc` | bool | 고정임금제 자동계산 | | S `ad70af70` |
| `fixed_overtime_hours/amount`, `fixed_night_*`, `fixed_holiday_*`, `fixed_holiday_overtime_*` | decimal/money + `*_enabled` | 고정 연장·야간·휴일·휴일연장 근로 | | S |
| `base_salary` | money | 기본급 (나머지 금액에서 역산) | | S, M |
| `annual_salary` | money | 연봉 (검토용) | | S |
| `has_bonus`, `bonus_amount`, `bonus_in_ordinary_wage` | bool, money, bool | 상여금 | | S `f9fbda28` |
| `pay_month` | enum | 임금지급시기 | `current`(당월), `next`(익월) | S `ac0b7597` |
| `pay_day` | int | 지급일 (31 = 말일) | 1–31 | S |
| `pay_method` | enum | 임금지급방법 | `transfer`, `direct` | S |
| `bank_code`, `account_number`, `account_holder` | text | 계좌 (`transfer`이면 필수) | | S |

> 기본 급여조건이 work-contract와 payroll-contract 중 어디에 속하는지는 **미확인**입니다. 급여 계산에 쓰는 값이라 payroll-contract에 두는 쪽을 권장합니다.

### 2.11 SocialInsuranceInfo (4대보험, 직원당 1개)

| 필드 | 타입 | 의미 | 허용 값 | 출처 |
| --- | --- | --- | --- | --- |
| `is_representative_or_executive` | bool | 대표자 혹은 임원 | | S `5a499f52` |
| `is_representative_relative` | bool | 대표자와 동거하는 친족 | | S |
| `is_person_of_merit` | bool | 독립유공자/국가유공자 | | S |
| `is_non_regular` | bool | 비상근 근로자 | | S |
| `nps_enrolled` / `nhis_enrolled` / `ei_enrolled` / `iais_enrolled` | bool | 국민연금/건강/고용/산재 가입 여부 | | S `136afd58` |
| `nps_exclusion_reason` | enum(한글) | 국민연금 제외 사유 | 14종(B:73745-73760): `만 18세 미만 중 국민연금 제외 신청자, 만 60세 이상, 무보수 대표자, 단시간 근로자(월 60h 미만), 초단시간 근로자(주 15h 미만), 일용 근로자 (월 8일 또는 60h 미만), 1개월 미만 기간의 근로자, 공적연금 가입자, 퇴직연금 수급권자, 조기노령연금 수급권자, 노령연금 수급권자 중 특수직종 근로자, 소재지가 일정하지 않은 사업장의 근로자, 면제 대상의 외국인, 생계급여 수급자 또는 의료급여 수급자` | B |
| `nhis_exclusion_reason` | enum(한글) | 건강보험 제외 사유 | 14종(B:73761-73776): `무보수 대표자, 단시간…, 초단시간…, 일용…, 비상근 근로자, 비상근 교직원, 시간제 공무원, 시간제 교직원, 현역병 전환복무된 자 무관후보생, 소재지 일정하지 않은…, 국가유공자 등 의료보호대상자, 의료급여 수급자, 면제 대상의 외국인, 국내에 체류하지 않는 자` | B |
| `ei_exclusion_reason` | enum(한글) | 고용보험 제외 사유 | 11종(B:73777-73790): `대표자, 사내이사 / 만 65세 이후 고용된 자 / 대표자와 동거하는 친족 / 대표자와 동거하지 않는 친족 중 배우자, 자녀 / 단시간… / 초단시간… / 공무원 / 사립학교 교직원 연금법 적용자 / 별정우체국직원 / 면제 대상의 외국인 / 고용보험 이중취득` | B |
| `iais_exclusion_reason` | enum(한글) | 산재보험 제외 사유 | `대표자, 사내이사 / 대표자와 동거하는 친족 / 건설업으로 임의적용사업장 대상` | B:73791 |
| `nps_pay_acquisition_month` | bool | 국민연금 취득월 납부 희망 | | S |
| `durunuri_applied` | bool | 두루누리 적용 | | S |
| `determinations[]` | `{code}` | 서버 자동 판정 결과 | `nps_over_60_new_hire`, `nps_over_60_incumbent`, `ei_over_65_new_hire` | B:73796 |
| `messages[]` | `{code}` | 안내 메시지 | `nps_under_60h_enrolled`, `EI_FOREIGNER_OPTIONAL`, `EI_FOREIGNER_RECIPROCITY_AGREEMENT`, `EI_FOREIGNER_RECIPROCITY_NON_AGREEMENT` (대소문자 혼재 그대로) | B:73801 |

### 2.12 DeductionInfo (소득세 및 기타공제, 직원당 1개)

| 필드 | 타입 | 의미 | 허용 값 | 출처 |
| --- | --- | --- | --- | --- |
| `income_tax_calc_method` | enum | 근로소득세 산출방법 | `tax_table_based`(간이세액표), `manual_input` | B:73876 |
| `manual_income_tax` | money, null | 직접입력 세액 | | 추정 |
| `income_tax_rate` | int | 소득세액 조정비율 | `80`, `100`, `120` | S, M, **법령**(소득세법 시행령 제194조 ②) |
| `income_tax_reduction_type` | enum | 감면 유형 | `none`, `small_biz`, `returning_korean_talent`, `foreign_technician` | B:73880 |
| `income_tax_reduction_application_type` | enum | 감면 적용 방식 | `""`, `payroll`, `year_end_set` | B:73886 |
| `income_tax_reduction_reason` | code | 감면 세부 사유 (청년/고령자/장애인/경력단절여성/특화선도기업…) | `income-tax-reduction-reasons/` 응답 | B:73900 |
| `income_tax_reduction_start_date`, `_end_date` | date | 감면기간 | 필수(감면 시) | S `d212acd6` |
| `income_tax_reduction_rate` | int | 감면율 | 90/70/50 | S, M |
| `income_tax_reduction_scope` | enum | 감면 적용부분 | 추정 `all|partial` | S (값 미확인) |
| `dependents_count` | int (읽기) | 전체 공제대상 가족(본인 포함) | | S `c97eeba3` (family에서 파생) |
| `children_8_to_20_count` | int (읽기) | 공제대상 가족 중 8~20세 자녀 | | S, **법령**(간이세액표 자녀 수 기준) |
| `student_loan_applied` | bool | 학자금대출 상환 신청 | | S `7f130732` |
| `student_loan_monthly_amount` | money | 월 공제액(매월 의무상환액) | | S |
| `student_loan_start_date`, `_end_date` | date | 상환 공제기간 | | S |

### 2.13 EmployeeDocument (문서 보관함)

| 필드 | 타입 | 의미 | 허용 값 | 출처 |
| --- | --- | --- | --- | --- |
| `id` | int | | | |
| `category` | fk/code | 문서 카테고리 | 계약서, 증명서, 동의서, 사직서, 기타 (`settings/document-categories/`) | S `32043b25`, B:73400 |
| `source_type` | enum | 출처 | 추정 `upload`, `e_sign`, `certificate` | B:74435 (키만 확인) |
| `file` | file | 원본 | PDF/JPEG/PNG, ≤10MB | S |
| `mime_type` | text | 클라이언트가 `file.type`을 보냄 | | B:74436 |
| `file_name`, `size`, `created`, `created_by` | | | | 추정 |

업로드는 multipart이고 키는 `category, source_type, file, mime_type`(B:74431-74438)입니다. **FormData는 케이스 변환 대상이 아니므로 클라이언트가 snake_case 키를 직접 씁니다.** 목록 파라미터는 추정 `?category=`입니다.

### 2.14 EmployeeMemo (특이사항)

- `memo`: 직원당 1개. `{content, updated, updated_by}`(추정). `PUT`으로 교체, `DELETE`로 비움.
- `memo-histories`: `[{content, created, created_by}]`(추정). **경로 끝에 슬래시가 없습니다**(B:73561). 라우터는 두 형태를 다 받아야 합니다.

### 2.15 LeavingReason (퇴직·상실 사유 코드)

- `GET employee/leaving-reason/`(레거시)와 `GET e-sign/:token/leaving-reasons/`(근로자 사직서)가 같은 코드 체계로 보입니다.
- 매뉴얼 예시는 "개인사정으로 인한 자진퇴사" → "다른 직장으로 옮기기 위해 이직한 경우"입니다. **고용보험 피보험자격 상실신고의 상실사유 구분코드와 같은 체계**로 추정합니다(**법령**: 고용보험법 시행규칙 별지 서식).

| 코드 | 상위 사유 (추정) |
| --- | --- |
| 11 | 개인사정으로 인한 자진퇴사 |
| 12 | 사업장 이전, 근로조건 변동, 임금체불 등으로 자진퇴사 |
| 22 | 폐업, 도산 |
| 23 | 경영상 필요 및 회사불황으로 인원감축 등에 의한 퇴사(해고·권고사직·명예퇴직 포함) |
| 26 | 근로자의 귀책사유에 의한 징계해고·권고사직 |
| 31 | 정년 |
| 32 | 계약기간만료, 공사종료 |
| 41 | 고용보험 비적용 |
| 42 | 이중고용 |

응답 형태는 추정 `[{code, name, details:[{code, name}]}]`입니다.

### 2.16 E-sign: Template

| 필드 | 타입 | 의미 | 허용 값 | 출처 |
| --- | --- | --- | --- | --- |
| `id` | int | | | |
| `template_type` | enum | 기본 템플릿 / 회사 사본 | `e_sign_template`, `company_e_sign_template` | B:74536-74539 |
| `base_template` | fk, null | 회사 사본의 원본 | | 추정 |
| `category` | fk→document_category | 카테고리 (계약서·동의서·증명서…) | | S `36d62eff` |
| `title` | text | 예: "근로계약서(정규직, 5인이상)" | | S |
| `document_kind` | enum | 근로계약서 / 일용직 근로계약서 / 단시간 / 연봉계약서 / 용역계약서 / 개인정보동의서 / 비밀유지서약서 / 사직서 / 재직·경력·퇴직증명서 / 표준취업규칙 | | M (코드 값 추정) |
| `contract_type` | enum, null | 정규직/계약직 | `regular|contract` | S 제목 |
| `workplace_size` | enum, null | 5인 이상/미만 | 추정 `gte5|lt5` | S `f5105c22` |
| `target_employment_type` | enum | 대상 직원 종류 | `E_SIGN_EMPLOYMENT_TYPE` 4값 (용역계약서 → businessemployee) | 추정 |
| `is_active` | bool | 사용 관리 토글 | | M |
| `body` / `fields[]` | json | 본문 블록과 입력 필드 정의 `{key, label, type, required, default, visible_toggle, source(employee.join_date…)}` | | S `371b9d5f` (구조 추정) |
| `default_seal` | fk→company_seal, null | 대표자 도장·사인 기본값 | | M "문서별로… 도장·사인 꼭 등록" |
| `is_certificate` | bool | 제증명 발급용 여부 | | 추정 |
| `updated_by`, `updated` | text(email), datetime | 수정자, 수정일시 | | S |

`PATCH`는 회사 사본에 저장합니다. 기본 템플릿을 처음 수정할 때 회사 사본을 만드는 copy-on-write로 추정합니다.

### 2.17 E-sign: CompanySeal

| 필드 | 타입 | 의미 | 출처 |
| --- | --- | --- | --- |
| `id` | int | | |
| `image` | file(url) | 도장·사인 이미지 (PNG 추정, 투명 배경) | S `c4e43628` |
| `source` | enum | `upload` / `drawn` | M (추정) |
| `created_by` | text(email) | 작성자 | S |
| `created` | date | 작성일자 | S |

제약: 회사당 **최대 5개**(M)입니다. 템플릿이나 진행 중 요청이 참조하는 도장을 삭제할 때의 처리는 **미확인**입니다. 권장안은 soft delete이고, 발송된 문서는 렌더링 시점 이미지를 스냅샷으로 보관합니다.

### 2.18 E-sign: NotiRecipient (알림 설정)

| 필드 | 타입 | 의미 | 제약 | 출처 |
| --- | --- | --- | --- | --- |
| `name` | text | 성명 | 필수 | S `ac2def5e` |
| `position` | fk→position, null | 직위 | | S |
| `phone` | text | 전화번호 (알림톡 수신) | 필수 | S |
| `email` | text | 이메일 | | S |

`PUT`으로 목록 전체를 교체합니다(B:73414). body는 추정 `{recipients:[...]}` 또는 배열이고, **최대 3개**입니다. 비어 있으면 대표자 연락처(`representative_set[role=boss]`)를 기본값으로 씁니다.

### 2.19 E-sign: Request / Recipient / Document

**ESignRequest**

| 필드 | 타입 | 의미 | 허용 값 | 출처 |
| --- | --- | --- | --- | --- |
| `id` | int | | | |
| `status` | enum | | `draft, pending, in_progress, completed, voided, expired, cancelled, send_failed` | B:74518-74527 |
| `templates[]` | `{template_type, template_id}` | 주 문서 + 첨부 문서 | `E_SIGN_TEMPLATE_TYPE` | B:74536, S "전자 문서 첨부" |
| `category` | 파생 | 목록 필터용 | | S |
| `workplace_size` | enum | 5인 이상/미만 | | S |
| `recipient` | ESignRecipient | 수신자 (요청당 1명 추정. 목록이 수신자 단위 행) | | S |
| `wage_type`, `work_condition`, `work_schedule_policy` | enum, fk, fk | 2단계 좌측 패널 | | S `371b9d5f` |
| `field_values` | json | 문서별 입력값 `{doc_index: {field_key: value, __hidden: [...]}}` | | 추정 |
| `company_seal` | fk | 회사 서명 이미지 | | M |
| `due_date` | date | 서명 기한 | | S "서명 기한 D-16(2026.07.09)" |
| `sent_at`, `signed_at`, `expired_at`, `cancelled_at`, `voided_at` | datetime | | | S |
| `signing_token` | text(secret) | 근로자 링크 토큰 | | routes |
| `result_file` | file | 서명 완료 PDF | | M |
| `created_by`, `created`, `updated` | | | | |

**ESignRecipient**

| 필드 | 타입 | 의미 | 출처 |
| --- | --- | --- | --- |
| `employment_type` | enum, null | `wageemployee, dailyemployee, businessemployee, otheremployee` | B:74530-74535 |
| `employee_id` | int, null | 기존 구성원. null이면 신규 계약자 | S "구성원에서 찾기"/"신규" 배지 |
| `name` | text | 필수 | S |
| `email` | text | 발송 시 필수 | M, S `0c50f7a0` |
| `phone` | text | 알림톡 (추정) | |
| `is_local` | bool | 필수 | S |
| `nationality`, `visa` | text | 외국인이면 필수 | M |
| `birth_date` | date | 본인확인용 (추정) | |

**ESignSignerSession** (서버 내부): `request_id`, `session_token`, `expires_at`, `verified_at`, `ip`, `user_agent`. 서명 완료 PDF에 감사 추적(audit trail)으로 들어가야 합니다(**법령**: 전자문서법·전자서명법상 증명력. 형식은 추정).

**SignerSeal**: 근로자가 만든 서명 이미지(`POST e-sign/:token/seals/` multipart). 요청 또는 (이메일/전화 기준) 서명자 단위로 보관합니다(추정).

### 2.20 Certificate (제증명 발급)

| 필드 | 타입 | 의미 | 허용 값 | 출처 |
| --- | --- | --- | --- | --- |
| `id` | int | | | |
| `status` | enum | | `issued, sending, sent, send_failed` | B:74572-74577 |
| `template` | fk | 재직/경력/퇴직증명서, 표준취업규칙 | | M |
| `employee` | `{employment_type, employee_id}` | 대상 구성원 | | 추정 |
| `field_values` | json | 용도, 제출처, 직위, 재직기간, 담당업무 등 | | 추정 |
| `issue_number` | text | 발급번호 | | 추정 |
| `issued_at` | datetime | | | 추정 |
| `file` | file | 렌더링된 PDF | | |
| `sent_to_email` / `sent_to_phone` | text | 발송 대상 | | 추정 |
| `signing_token`, `token_expires_at` | text, datetime | 근로자 수령 링크 | | routes `expired` 화면 |
| `created_by` | | | | |

### 2.21 DocumentForm (서식 모음, nexus)

| 필드 | 타입 | 의미 | 출처 |
| --- | --- | --- | --- |
| `id` | int | | 추정 |
| `title` | text | 서식명 | M |
| `description` | text | 설명 | M |
| `type` / `category` | enum | `인사, 경리, 부동산, 주식, 이사회, 일반계약` | M, `type-count` 경로 |
| `file_url` | url | 다운로드 파일 (hwp/docx/xlsx 추정) | 추정 |

`GET document-form?type=&search=`와 `GET document-form/type-count` → `[{type, count}]`(추정)입니다. 회사 범위가 아니라 전역 데이터입니다.

---

## 3. 상태와 전이

### 3.1 구성원(신규) `EMPLOYEE_STATUS` (B:73462-73475)

| 값 | 쿼리 정수 | 의미 (추정) | 계산 규칙 (권장) |
| --- | --- | --- | --- |
| `PRE_JOINED` | 1 | 입사 예정 | `join_date > today` |
| `WORKING` | 2 | 현재 근무자(재직 중이고 휴직이 아님). "현재 근무자만 보기" 필터 | `JOINED && !on_leave(today)` |
| `JOINED` | 3 | 재직 | `join_date ≤ today && (leave_date is null || leave_date ≥ today)` |
| `LEAVE` | 4 | 휴직 | 오늘을 포함하는 `leave_of_absences` 존재 |
| `RESIGNED` | 5 | 퇴직 | `leave_date < today` (퇴직일 당일까지 재직) |

- 상태는 **저장하지 않고 날짜로 계산**하는 쪽을 권장합니다. 탭 카운트는 `count-by-status`가 `{all, joined, leave, resigned, …}`로 돌려준다고 추정합니다.
- 전이 이벤트: 등록 → (입사일 도달) 재직 → 휴직 등록 → (휴직 종료·복직) 재직 → 퇴직 등록(`PUT retirement-info`) → 퇴직. 퇴직 취소(`DELETE retirement-info`)는 재직으로 돌아갑니다.
- 각 이벤트가 4대보험 신고 작업(취득·휴직·복직·상실·피부양자)을 만듭니다. 2.3 `employee_work` 참고.

### 3.2 레거시 `EmploymentStatus` (B:73209-73217)

```text
임시저장 ─(필수정보 입력 후 등록)→ 입사처리중 ─(담당자 취득신고 완료)→ 재직
재직 ─(휴직 신청)→ 휴직처리중 → 휴직 ─(복직)→ 재직
재직 ─(퇴사 신청)→ 퇴사처리중 → 퇴사
```

화면의 "신청중" 카운트는 `*처리중` 3종의 합입니다(S `5a2f5c3b`). 처리 주체는 세무 담당자(`UserType` 1/2)입니다(추정).

### 3.3 근로계약 `CONTRACT_STATUS` (B:73457)

`scheduled`(`start_date > today`) → `active` → `expired`(`end_date < today`). 계산 필드입니다. `CONTRACT_DISPLAY_STATUS`는 같은 상수입니다(B:73482).

### 3.4 전자서명 요청 `E_SIGN_REQUEST_STATUS` (B:74518)

```text
             PATCH(임시저장)
           ┌──────────┐
           ▼          │
        [draft] ──────┘
           │ 발송 (POST 생성 시 send 플래그 또는 PATCH status, 미확인)
           ├──────────────→ [send_failed] ──revert-to-draft──→ [draft]
           ▼
       [pending]  (서명 전, 링크 미열람 또는 미인증)
           │ 근로자 verify 성공 / 첫 서명
           ▼
     [in_progress] (서명 중)
           │ complete
           ▼
      [completed] ──void──→ [voided]
pending ──cancel──→ [cancelled] ──revert-to-draft──→ [draft]
pending|in_progress ──(due_date 경과, 배치)──→ [expired] ──재발송(revert-to-draft 후 재발송 추정)──→ …
draft|expired|cancelled ──DELETE──→ (삭제)
```

| 액션 | 엔드포인트 | 허용 원천 상태 (추정, 매뉴얼 근거) |
| --- | --- | --- |
| 수정 | `PATCH e-sign-requests/:id/` | `draft` (M: 진행 중·완료 문서는 수정 불가) |
| 삭제 | `DELETE e-sign-requests/:id/` | `draft`, `expired`, `cancelled`, `send_failed` (S: 기한만료에 삭제 버튼) |
| 요청 취소 | `POST .../cancel/` | `pending` (S: "서명 전"에만 버튼). `in_progress` 허용 여부 미확인 |
| 무효화 | `POST .../void/` | `completed` (추정: 완료 계약 파기) |
| 임시저장으로 되돌리기 | `POST .../revert-to-draft/` | `cancelled`, `expired`, `send_failed` (S "재발송"이 이 경로로 추정) |
| 다운로드 | `GET .../download/` | `completed` |

근로자 화면의 `cancelled`/`expired`/`invalid`는 요청 상태 `cancelled|voided`, `expired`, 토큰 불일치에 대응합니다.

### 3.5 제증명 `CERTIFICATE_ISSUANCE_STATUS` (B:74572)

```text
POST certificates/ → [issued] ─send→ [sending] ─(발송 성공)→ [sent]
                                          └─(실패)→ [send_failed] ─send(재시도)→ [sending]
```

`DELETE`는 모든 상태에서 허용한다고 추정합니다. 다만 `sent`이면 토큰도 무효화해야 합니다. 근로자 토큰이 만료되면 `/certificates/worker/:token/expired`로 갑니다.

### 3.6 퇴직금 정산 `SEVERANCE_SETTLEMENT_STATUS` (B:73839)

`in_progress → completed`, `excluded`(정산 제외). 퇴직금 정산 화면은 급여 노트 범위이고, 여기서는 삭제 가드에만 씁니다(`RETIREMENT_COMPLETED`).

---

## 4. 규칙과 계산

| # | 규칙 | 내용 | 근거 |
| --- | --- | --- | --- |
| R1 | 등록 필수값 | 성명, 주민등록번호, 입사일자 | M |
| R2 | 중복 직원 | 같은 회사·같은 주민번호(+재입사가 아님)이면 `400 DUPLICATE_EMPLOYEE` | B:73510 |
| R3 | 삭제 가드 | 퇴직금 정산이 완료된 직원은 `400 RETIREMENT_COMPLETED`. 급여대장에 들어간 직원도 막는 것을 권장 | B:73511, 추정 |
| R4 | 부서/직위 삭제 | 한 번이라도 쓰인 부서·직위는 삭제 불가 | M |
| R5 | 계약 만료 알림 | `contract-expiry-alert`: `contract` 유형 활성 계약 중 `end_date - today ≤ N일`이면 `expiring_soon`, 지났는데 갱신 계약이 없으면 `expired`. **N 미확인**(30일 권장) | B:73476, B:73501, 추정 |
| R6 | 무기계약 전환 알림 | `indefinite-conversion-alert`: 같은 근로자의 기간제(`contract`) 계약 기간을 합산해(공백 없이 연속 갱신) **2년 초과** 예정이거나 이미 넘었으면 경고. 예외: 55세 이상, 전문자격, 휴직 대체 등 | **법령**: 기간제법 제4조(2년 초과 시 무기계약 간주). 예외 판정은 추정 |
| R7 | 수습 임금 | 수습 지급률은 90% 이상이어야 하고 계약 1년 미만이면 감액 불가. 단순노무직종은 감액 불가 | **법령**: 최저임금법 제5조 ②, 시행령 제3조. 앱의 구현 범위는 추정 |
| R8 | 최저임금 판정 | 월급 ÷ 월 소정근로시간(기본 209h)과 최저시급을 비교합니다. 숨긴 항목과 최저임금 산입 제외 항목(식대 등 비과세 복리후생비의 산입 비율)을 빼고 계산. 미달이면 경고 | M, S `f9cda41c`, **법령**: 최저임금법 제6조 ④ |
| R9 | 기준시급·통상시급 | 기준시급 = 기본급 ÷ 월 소정근로시간. 통상시급 = (기본급 + 통상임금 지급항목 + [상여 통상임금 포함 시 연 상여 ÷ 12]) ÷ 월 소정근로시간. 수습 기준시급 = 기준시급 × 지급률 | S `8407bb45`, `7f698daa`, `f9fbda28`. 식은 추정 |
| R10 | 고정임금제 자동계산 | 고정연장 = 통상시급 × 1.5 × h, 고정야간 = 통상시급 × 0.5 × h, 고정휴일 = × 1.5(8h 이하), 휴일연장 = × 2.0. 기본급 = 월급 − 지급항목 − 고정수당 합계(역산) | S `ad70af70`(아래 검증 메모: 화면 값은 가산율 없이 통상시급 × 시간). **계수 검증 필요**. **법령**: 근로기준법 제56조 |
| R11 | 월 소정근로시간 불러오기 | 근로시간 정책의 주 소정근로시간에서 파생: (주 소정 + 주휴) × 365 ÷ 7 ÷ 12 → 40h → 209h | S, **법령**(고용노동부 산정 관행) |
| R12 | 4대보험 자동 판정 | `nps_over_60_new_hire` / `nps_over_60_incumbent`: 만 60세 이상은 국민연금 가입 제외(신규·재직자 구분). `ei_over_65_new_hire`: 만 65세 이후 새로 고용되면 고용보험(실업급여) 제외. `nps_under_60h_enrolled`: 월 60h 미만인데 가입 상태면 안내. 외국인 고용보험: 체류자격별 임의가입·상호주의 | B:73796-73806, **법령**: 국민연금법 제6조, 고용보험법 제10조 |
| R13 | 재판정(redetermine) | 생년월일·근로시간·체류자격·입사일이 바뀌면 `GET redetermine/`으로 서버 판정을 다시 받습니다. `POST preview/`는 저장하지 않은 폼 값으로 판정을 미리 봅니다(클라이언트가 `AbortSignal`로 취소, B:73817-73827) | B |
| R14 | 두루누리 적용 대상 | 근로자 10인 미만 사업장, 월평균보수 270만원 미만, 1인당 최대 36개월, 최대 80% 지원. 고용보험 최종 공제액 = 기 공제액 − 실업급여 지원금 | M (2026 기준), **법령**(고용보험·국민연금 보험료 지원 고시) |
| R15 | 휴직 → 4대보험 | 휴직을 등록하면 휴직 신고가 진행됩니다. 국민연금 납부예외, 건강보험 납입고지유예(1개월 이상)는 옵션 | M, S |
| R16 | 육아휴직 근속 포함 | 육아휴직 기간은 근속기간에 포함되며 UI에서 강제 | S, **법령**: 남녀고용평등법 제19조 ④ |
| R17 | 퇴직 사유 → 상실신고 | 고른 (상세)사유를 4대보험 상실신고에 그대로 씁니다 | M |
| R18 | 퇴직일 ≥ 중간정산일 | 위반이면 `400 LEAVE_DATE_BEFORE_INTERIM` | B:73855 |
| R19 | 소득세 조정비율 | 80/100/120% 중 선택, 기본 100% | M, **법령**: 소득세법 시행령 제194조 |
| R20 | 소득세 감면 | 중소기업 취업자 감면: 청년 90%·5년, 고령자·장애인·경력단절여성 70%·3년, 연 200만원 한도. 내국인 우수인력 복귀 50%·10년. 외국인 기술자 50%·10년(특화선도 3년 70% + 7년 50%) | M, **법령**: 조특법 제30조·제18조의3·제18조 |
| R21 | 공제대상 가족 수 | 인적공제 대상자 중 `is_year_end_target`인 사람 + 본인. 8~20세 자녀 수는 간이세액표 적용에 씁니다 | S, **법령**(간이세액표) |
| R22 | 전자서명 수신자 | 외국인은 국적·체류자격 필수. 발송 시 이메일 필수 | M |
| R23 | 5인 이상 여부 | 대표자·임원을 뺀 상시 근로자 수로 템플릿 변형을 고릅니다(5인 미만은 근로기준법 일부 미적용: 연장·야간가산, 연차 등) | M, **법령**: 근로기준법 제11조, 시행령 별표1 |
| R24 | 서명 기한 만료 | `due_date` 다음날 00:00에 `expired` 처리(S "만료 일시 2026.06.14 00:00"). 배치나 조회 시점 계산이 필요하고, 알림톡을 보냅니다 | S, M |
| R25 | 진행 중 문서 불변 | `pending` 이후로는 PATCH/DELETE 금지 | M |
| R26 | 알림 수신자 | 최대 3명, 기본은 대표자 | M |
| R27 | 도장·사인 | 회사당 최대 5개 | M |
| R28 | 문서 업로드 | PDF/JPEG/PNG, 파일당 10MB | S |
| R29 | 서명 완료 후속처리 | 근로계약서·연봉계약서가 완료되면 `work_contract(creation_method=esign)`과 `payroll_contract`를 생성·갱신하고(추정), 문서 보관함에 PDF를 저장합니다(`source_type=e_sign` 추정). 신규 계약자는 `wage_employee`를 만듭니다(추정). 사직서가 완료되면 퇴직 사유를 `retirement-info` 초안에 반영합니다(추정) | B:73456, 추정 |
| R30 | 제증명 템플릿 공유 | 제증명은 전자서명 템플릿 저장소를 같이 씁니다 | M `08-설정/05` |

> R10 검증 메모: S `ad70af70`에서 고정 연장 30h = 645,492원, 야간 5h = 107,582원입니다. 107,582 ÷ 5 = 21,516.4 = 통상시급(S `7f698daa`의 21,516.39) × 1.0이고, 645,492 ÷ 30 = 21,516.4 × 1.0입니다. 즉 **이 화면 값은 가산율 없이 통상시급 × 시간**입니다. 가산(0.5/1.5)을 별도 항목으로 처리하는지, 금액 산식이 다른지 **미확인**이므로 급여 노트와 맞춰야 합니다.

---

## 5. 엔드포인트 표

> 경로 접두는 `/api/company/:companyId`(생략 표기 `…`)이고 백엔드는 모두 `sf`입니다. `B:` 줄은 함수 정의 줄입니다. 응답의 "목록"은 DRF 페이지네이션 봉투입니다(추정 포함).

### 5.1 레거시 직원 / 서식 모음

| # | 메서드 | 경로 | 번들 메서드 | 목적 | 요청 | 응답 | B: |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | GET | `/nexus-api/document-form` | `document.getDocumentForms` | 서식 목록 | params(추정 `type, search, limit, offset`) | 목록 `DocumentForm` 추정 | 73201 |
| 2 | GET | `/nexus-api/document-form/type-count` | `document.getCategories` | 카테고리별 개수 | params | `[{type,count}]` 추정 | 73203 |
| 3 | GET | `…/employee/` | `employee.getEmployee` | 레거시 직원 목록 | params `simple: "True"|"False"` (+필터 추정) | **목록 `{count,next,previous,results:Employee[]}` (목업으로 확인)** | 73229 |
| 4 | GET | `…/employee/leaving-reason/` | `employee.getLeavingReason` | 퇴사 사유 코드 | params | 코드 트리 추정 | 73231 |

### 5.2 설정 (전자서명·제증명·문서 카테고리)

| # | 메서드 | 경로 | 번들 메서드 | 목적 | 요청 | 응답 | B: |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 5 | GET | `…/employment/settings/document-categories/` | `settings.getSettingsDocumentCategories` | 문서 카테고리 | params | `[{id,name,code}]` 추정 | 73399 |
| 6 | GET | `…/employment/settings/company-seals/` | `settings.getCompanySeals` | 도장·사인 목록 | – | `CompanySeal[]` 추정 | 73403 |
| 7 | POST | `…/employment/settings/company-seals/` | `settings.postCompanySeal` | 도장·사인 등록 | **multipart** (키 추정 `image`) | `CompanySeal` | 73405 |
| 8 | DELETE | `…/employment/settings/company-seals/:sealId/` | `settings.deleteCompanySeal` | 삭제 | – | 204 | 73409 |
| 9 | GET | `…/employment/settings/e-sign-noti-recipients/` | `settings.getSettingsESignNotiRecipients` | 알림 수신자 | – | `NotiRecipient[]` 추정 | 73411 |
| 10 | PUT | `…/employment/settings/e-sign-noti-recipients/` | `settings.putSettingsESignNotiRecipients` | 수신자 일괄 교체(≤3) | body 전체 목록 | 저장 결과 | 73413 |
| 11 | GET | `…/employment/settings/e-sign-templates/` | `eSignTemplates.getESignTemplates` | 템플릿 목록 | params(추정 `search, category, is_active, is_certificate`) | 목록 | 74465 |
| 12 | GET | `…/employment/settings/e-sign-templates/:templateId/` | `eSignTemplates.getESignTemplate` | 템플릿 상세 | – | `Template` + fields | 74469 |
| 13 | PATCH | `…/employment/settings/e-sign-templates/:templateId/` | `eSignTemplates.patchESignTemplate` | 편집·사용 토글·기본 도장 | 부분 body | `Template` | 74471 |

### 5.3 구성원(근로소득) 본체

| # | 메서드 | 경로 | 번들 메서드 | 목적 | 요청 | 응답 | B: |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 14 | GET | `…/employment/wage-employees/` | `wageEmployees.getEmployees` | 목록 | params(2.2) | 목록 | 73488 |
| 15 | GET | `…/employment/wage-employees/count-by-status/` | `getEmployeesCountByStatus` | 탭 카운트 | params(검색 조건 공유) | `{status:count}` 추정 | 73490 |
| 16 | GET | `…/employment/wage-employees/export/` | `getEmployeesExport` | 엑셀 내보내기 | params | **blob** (xlsx 추정) | 73494 |
| 17 | GET | `…/employment/wage-employees/contract-expiry-alert/` | `getContractExpiryAlert` | 계약 만료 경고 | – | `{expiring_soon_count, expired_count, employees[]}` 추정 | 73500 |
| 18 | POST | `…/employment/wage-employees/` | `postEmployee` | 등록 | `name, registration_number, identification_number_type?, is_local, join_date, work_code?, email?, department?, position?` | `WageEmployee`. 400 `DUPLICATE_EMPLOYEE` | 73508 |
| 19 | DELETE | `…/employment/wage-employees/:employeeId/` | `deleteEmployee` | 삭제 | – | 204. 400 `RETIREMENT_COMPLETED` | 73512 |
| 20 | GET | `…/employment/wage-employees/:employeeId/` | `getEmployee` | 상세(헤더 + 기본) | – | `WageEmployee` | 73514 |
| 21 | PATCH | `…/employment/wage-employees/:employeeId/` | `patchEmployee` | 기본 정보 수정 | 부분 body | `WageEmployee` | 73516 |
| 22 | GET | `…/employment/wage-employees/:employeeId/common-info/` | `getEmployeeCommonInfo` | 공통 인적 정보 | – | 2.1 필드 추정 | 73518 |
| 23 | PUT | `…/employment/wage-employees/:employeeId/common-info/` | `putEmployeeCommonInfo` | 공통 인적 정보 저장 | 전체 body | 동일 | 73520 |
| 24 | GET | `…/employment/wage-employees/:employeeId/leave-of-absence-info/` | `getLeaveOfAbsenceInfo` | 휴직 요약 | – | 추정 | 73525 |
| 25 | GET | `…/wage-employees/:employeeId/leave-of-absences/` | `getLeaveOfAbsences` | 휴직 이력 | `limit, offset` | 목록 | 73529 |
| 26 | GET | `…/wage-employees/:employeeId/leave-of-absences/:loaId/` | `getLeaveOfAbsence` | 휴직 상세 | – | `LeaveOfAbsence` | 73536 |
| 27 | POST | `…/wage-employees/:employeeId/leave-of-absences/` | `postLeaveOfAbsence` | 휴직 등록 | 2.7 필드 | `LeaveOfAbsence` | 73540 |
| 28 | PUT | `…/wage-employees/:employeeId/leave-of-absences/:loaId/` | `putLeaveOfAbsence` | 휴직 수정(복직 포함 추정) | 전체 body | 동일 | 73545 |
| 29 | DELETE | `…/wage-employees/:employeeId/leave-of-absences/:loaId/` | `deleteLeaveOfAbsence` | 휴직 삭제 | – | 204 | 73550 |
| 30 | GET | `…/wage-employees/:employeeId/memo/` | `getMemo` | 특이사항 | – | `{content,…}` | 73554 |
| 31 | PUT | `…/wage-employees/:employeeId/memo/` | `putMemo` | 특이사항 저장 | `{content}` 추정 | 동일 | 73556 |
| 32 | DELETE | `…/wage-employees/:employeeId/memo/` | `deleteMemo` | 특이사항 삭제 | – | 204 | 73558 |
| 33 | GET | `…/wage-employees/:employeeId/memo-histories` (**슬래시 없음**) | `getMemoHistories` | 메모 이력 | – | 배열 또는 목록 | 73560 |

### 5.4 부서·직위

| # | 메서드 | 경로 | 번들 메서드 | 목적 | 요청 | 응답 | B: |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 34 | GET | `…/employment/departments/` | `departments.getDepartments` | 부서 목록 | params | `Department[]`/목록 | 73584 |
| 35 | POST | `…/employment/departments/bulk/` | `departments.postDepartmentBulk` | 부서 일괄 저장 | 목록 body | 저장 결과 | 73586 |
| 36 | GET | `…/employment/positions/` | `positions.getPositions` | 직위 목록 | params | | 73592 |
| 37 | POST | `…/employment/positions/bulk/` | `positions.postPositionBulk` | 직위 일괄 저장 | 목록 body | | 73594 |

### 5.5 인적공제 대상자

| # | 메서드 | 경로 | 번들 메서드 | 목적 | 요청 | 응답 | B: |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 38 | GET | `…/wage-employees/:employeeId/family-members/` | `wageFamilies.getFamilies` | 목록 | params | 목록 | 73626 |
| 39 | GET | `…/wage-employees/:employeeId/family-members/:familyId/` | `getFamily` | 상세 | – | `FamilyMember` | 73631 |
| 40 | POST | `…/wage-employees/:employeeId/family-members/` | `postFamily` | 등록 | 2.6 필드 | `FamilyMember` | 73635 |
| 41 | PUT | `…/wage-employees/:employeeId/family-members/:familyId/` | `putFamily` | 수정 | 전체 body | | 73640 |
| 42 | DELETE | `…/wage-employees/:employeeId/family-members/:familyId/` | `deleteFamily` | 삭제 | – | 204 | 73645 |
| 43 | POST | `…/family-members/:familyId/attachments/` | `postFamilyAttachment` | 첨부 업로드 | **multipart** | `Attachment` | 73649 |
| 44 | PATCH | `…/family-members/:familyId/attachments/:attachmentId/` | `patchFamilyAttachment` | 첨부 교체 | **multipart** | | 73655 |
| 45 | DELETE | `…/family-members/:familyId/attachments/:attachmentId/` | `deleteFamilyAttachment` | 첨부 삭제 | – | 204 | 73661 |

### 5.6 근로계약 / 급여계약

| # | 메서드 | 경로 | 번들 메서드 | 목적 | 요청 | 응답 | B: |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 46 | GET | `…/wage-employees/:employeeId/work-contracts/indefinite-conversion-alert/` | `wageWorkContracts.getIndefiniteConversionAlert` | 무기계약 전환 경고 | – | `{is_target, total_contract_days, conversion_date}` 추정 | 73680 |
| 47 | GET | `…/wage-employees/:employeeId/work-contracts/` | `getWorkContracts` | 목록 | params | 목록 | 73684 |
| 48 | GET | `…/wage-employees/:employeeId/work-contracts/:contractId/` | `getWorkContract` | 상세 | – | `WorkContract` | 73689 |
| 49 | POST | `…/wage-employees/:employeeId/work-contracts/` | `postWorkContract` | 등록 | 2.9 필드 | | 73693 |
| 50 | PUT | `…/wage-employees/:employeeId/work-contracts/:contractId/` | `putWorkContract` | 수정 | | | 73698 |
| 51 | DELETE | `…/wage-employees/:employeeId/work-contracts/:contractId/` | `deleteWorkContract` | 삭제 | – | 204 | 73703 |
| 52 | GET | `…/wage-employees/:employeeId/payroll-contracts/` | `wagePayrollContracts.getPayrollContracts` | 목록 | params | 목록 | 73715 |
| 53 | GET | `…/wage-employees/:employeeId/payroll-contracts/:contractId/` | `getPayrollContract` | 상세 | – | `PayrollContract` | 73720 |
| 54 | POST | `…/wage-employees/:employeeId/payroll-contracts/` | `postPayrollContract` | 등록 | 2.10 필드 | | 73724 |
| 55 | PUT | `…/wage-employees/:employeeId/payroll-contracts/:contractId/` | `putPayrollContract` | 수정 | | | 73729 |
| 56 | DELETE | `…/wage-employees/:employeeId/payroll-contracts/:contractId/` | `deletePayrollContract` | 삭제 | – | 204 | 73734 |

### 5.7 4대보험 / 퇴직 / 소득세공제

| # | 메서드 | 경로 | 번들 메서드 | 목적 | 요청 | 응답 | B: |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 57 | GET | `…/wage-employees/:employeeId/social-insurance-info/` | `wageSocialInsuranceInfo.getWageSocialInsuranceInfo` | 조회 | – | 2.11 | 73808 |
| 58 | PUT | `…/wage-employees/:employeeId/social-insurance-info/` | `putWageSocialInsuranceInfo` | 저장 | 2.11 쓰기 필드 | 2.11 | 73812 |
| 59 | POST | `…/wage-employees/:employeeId/social-insurance-info/preview/` | `previewWageSocialInsuranceInfo` | 미저장 값 판정 미리보기 | 폼 값(취소 가능) | `{determinations, messages, 권장 가입여부}` 추정 | 73817 |
| 60 | GET | `…/wage-employees/:employeeId/social-insurance-info/redetermine/` | `redetermineWageSocialInsuranceInfo` | 서버 재판정 | – (취소 가능) | 2.11 추정 | 73823 |
| 61 | GET | `…/wage-employees/:employeeId/retirement-info/` | `wageRetirementInfo.getRetirementInfo` | 조회 | – | 2.8 | 73858 |
| 62 | PUT | `…/wage-employees/:employeeId/retirement-info/` | `putRetirementInfo` | 퇴직 등록·수정 | 2.8 필드 | 2.8. 400 `LEAVE_DATE_BEFORE_INTERIM` | 73862 |
| 63 | DELETE | `…/wage-employees/:employeeId/retirement-info/` | `deleteRetirementInfo` | 퇴직 취소 | – | 204 | 73867 |
| 64 | GET | `…/wage-employees/:employeeId/deduction-info/` | `wageDeductionInfo.getDeductionInfo` | 조회 | – | 2.12 | 73891 |
| 65 | PUT | `…/wage-employees/:employeeId/deduction-info/` | `putDeductionInfo` | 저장 | 2.12 | 2.12 | 73895 |
| 66 | GET | `…/employment/wage-employees/income-tax-reduction-reasons/` | `getIncomeTaxReductionReasons` | 감면 사유 코드 | – | `[{type, code, name, rate, period_years, annual_limit}]` 추정 | 73900 |

### 5.8 기타 소득 유형 직원 / 문서 보관함

| # | 메서드 | 경로 | 번들 메서드 | 목적 | 요청 | 응답 | B: |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 67 | PATCH | `…/employment/business-employees/:employeeId/` | `businessEmployees.patchEmployee` | 사업소득자 수정 | 부분 body | 미확인 | 74414 |
| 68 | PATCH | `…/employment/daily-employees/:employeeId/` | `dailyEmployees.patchEmployee` | 일용직 수정 | | | 74417 |
| 69 | PATCH | `…/employment/other-employees/:employeeId/` | `otherEmployees.patchEmployee` | 기타소득자 수정 | | | 74420 |
| 70 | GET | `…/wage-employees/:employeeId/documents/` | `wageDocuments.getDocuments` | 문서 목록 | params(`category` 추정) | 목록 | 74423 |
| 71 | GET | `…/wage-employees/:employeeId/documents/:documentId/` | `getDocument` | 문서 메타 | – | `EmployeeDocument` | 74427 |
| 72 | POST | `…/wage-employees/:employeeId/documents/` | `postDocument` | 업로드 | **multipart** `category, source_type, file, mime_type` | `EmployeeDocument` | 74441 |
| 73 | DELETE | `…/wage-employees/:employeeId/documents/:documentId/` | `deleteDocument` | 삭제 | – | 204 | 74449 |
| 74 | GET | `…/wage-employees/:employeeId/documents/:documentId/download/` | `getDocumentDownload` | 다운로드 | – | **blob** | 74453 |

### 5.9 전자서명 요청 (관리자)

| # | 메서드 | 경로 | 번들 메서드 | 목적 | 요청 | 응답 | B: |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 75 | GET | `…/employment/e-sign-requests/` | `eSignRequests.getESignRequests` | 목록 | params(추정 `date_type, start_date, end_date, status, category, employee_name, search, limit, offset`) | 목록 | 74528 |
| 76 | POST | `…/employment/e-sign-requests/` | `postESignRequest` | 생성(임시저장 또는 발송) | 2.19 (`templates, workplace_size, recipient{employment_type, employee_id | name,email,is_local,nationality,visa}, wage_type, work_condition, work_schedule_policy, field_values, company_seal, send?`) | `ESignRequest` | 74540 |
| 77 | GET | `…/employment/e-sign-requests/:requestId/` | `getESignRequest` | 상세(편집 재개) | – | `ESignRequest` | 74542 |
| 78 | PATCH | `…/employment/e-sign-requests/:requestId/` | `patchESignRequest` | 임시저장 수정 / 발송 | 부분 body | | 74544 |
| 79 | DELETE | `…/employment/e-sign-requests/:requestId/` | `deleteESignRequest` | 삭제 | – | 204 | 74546 |
| 80 | POST | `…/employment/e-sign-requests/:requestId/cancel/` | `postESignRequestCancel` | 요청 취소 | (body 없음) | `ESignRequest` | 74548 |
| 81 | POST | `…/employment/e-sign-requests/:requestId/void/` | `postESignRequestVoid` | 무효화 | (body 없음) | | 74550 |
| 82 | POST | `…/employment/e-sign-requests/:requestId/revert-to-draft/` | `postESignRequestRevertToDraft` | 임시저장으로 되돌림 | (body 없음) | | 74552 |
| 83 | GET | `…/employment/e-sign-requests/:requestId/download/` | `getESignRequestDownload` | 완료 PDF | – | **blob** | 74556 |

### 5.10 제증명 (관리자)

| # | 메서드 | 경로 | 번들 메서드 | 목적 | 요청 | 응답 | B: |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 84 | GET | `…/employment/certificates/` | `certificateIssuances.getCertificateIssuances` | 목록 | params(`status, search, limit, offset` 추정) | 목록 | 74578 |
| 85 | POST | `…/employment/certificates/` | `postCertificateIssuance` | 발급 | `template, employment_type, employee_id, field_values, company_seal` 추정 | `Certificate(issued)` | 74580 |
| 86 | GET | `…/employment/certificates/:certificateId/` | `getCertificateIssuance` | 상세 | – | `Certificate` | 74582 |
| 87 | POST | `…/employment/certificates/download/` | `postCertificateIssuanceDownload` | (일괄) 다운로드 | `{ids:[...]}` 추정 | **blob** (PDF 또는 zip) | 74584 |
| 88 | POST | `…/employment/certificates/:certificateId/send/` | `postCertificateIssuanceSend` | 근로자에게 발송 | body 생략 시 `{}` (수신처 override 추정) | `Certificate(sending)` | 74589 |
| 89 | DELETE | `…/employment/certificates/:certificateId/` | `deleteCertificateIssuance` | 삭제 | – | 204 | 74591 |
| 90 | GET | `…/employment/certificates/count-by-status/` | `getCertificateIssuanceCountByStatus` | 상태 카운트 | params | `{issued,sending,sent,send_failed}` 추정 | 74593 |

### 5.11 근로자용 공개 API (회사 경로 없음, 비로그인)

| # | 메서드 | 경로 | 번들 메서드 | 목적 | 인증 | 요청 | 응답 | B: |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 91 | GET | `/api/employment/e-sign/:signingToken/summary/` | `eSignSigner.getESignSignerSummary` | 진입 요약 | 토큰 | – | `{status, company_name, recipient_name(마스킹), documents:[{index,title}], due_date}` 추정 | 74483 |
| 92 | POST | `/api/employment/e-sign/:signingToken/verify/` | `postESignSignerVerify` | 본인확인 | 토큰 | 본인확인 값(추정 `birth_date` 또는 이메일/휴대폰 OTP) | `{session_token, expires_at}` 추정 | 74485 |
| 93 | GET | `/api/employment/e-sign/:signingToken/documents/` | `getESignSignerDocuments` | 서명 문서 | `X-ESign-Session` | – | 렌더 데이터 + 근로자 입력 필드 | 74487 |
| 94 | GET | `/api/employment/e-sign/:signingToken/seals/` | `getESignSignerSeals` | 내 서명 목록 | 세션 | – | `[{id,image}]` | 74489 |
| 95 | POST | `/api/employment/e-sign/:signingToken/seals/` | `postESignSignerSeal` | 서명 이미지 등록 | 세션 | **multipart** | `{id,image}` | 74491 |
| 96 | POST | `/api/employment/e-sign/:signingToken/complete/` | `postESignSignerComplete` | 서명 제출 | 세션 | `{documents:[{index, field_values, seal_id}], leaving_reason?, agreed_at}` 추정 | 200 → 완료 화면 | 74498 |
| 97 | GET | `/api/employment/e-sign/:signingToken/leaving-reasons/` | `getESignSignerLeavingReasons` | 사직서 사유 선택지 | 세션 | – | 2.15 | 74500 |
| 98 | GET | `/api/employment/e-sign/:signingToken/download/` | `getESignSignerDownload` | 서명본 다운로드 | 세션 | – | **blob** | 74502 |
| 99 | GET | `/api/employment/certificates/:signingToken/summary/` | `certificateSigning.getCertificateSigningSummary` | 진입 요약 | 토큰 | – | 추정 | 74607 |
| 100 | POST | `/api/employment/certificates/:signingToken/verify/` | `postCertificateSigningVerify` | 본인확인 | 토큰 | 추정 | `{session_token}` 추정 | 74609 |
| 101 | GET | `/api/employment/certificates/:signingToken/download/` | `getCertificateSigningDownload` | 증명서 다운로드 | `X-ESign-Session` | – | **blob** | 74611 |

**합계: 메서드 단위 101개, 고유 경로 67개.** api-endpoints.txt 기준으로 53–78줄 26개(범위 밖 `settings/payroll-*`·`work-conditions*`·`work-schedule-policies*`는 79–91줄에 따로 있음), 92–120줄 29개, 284–293줄 10개, 314–315줄 2개를 더한 값입니다. `memo-histories`는 슬래시 없는 경로로 1개로 셉니다.

---

## 6. 외부 연동 경계

| 경계 | 쓰는 곳 | 어댑터 인터페이스 (제안) | 비고 |
| --- | --- | --- | --- |
| **이메일 발송** | 전자서명 요청(서명 링크), 제증명 발송, 서명 완료 사본 | `Mailer.send({to, template, vars, attachments?})` | `send_failed` 상태를 만들 수 있으므로 동기 실패와 비동기 bounce를 구분. tax 백엔드와 공용 |
| **카카오 알림톡** | 전자서명 완료·기한 만료 → 알림 수신자(≤3), 근로자 서명 요청(추정), 제증명 발송(추정) | `KakaoNotifier.send({phone, template_code, vars})` (SMS fallback) | 템플릿 사전 심사 필요. 수신자 기본값은 대표자 |
| **PDF 렌더링** | 전자서명 미리보기·완료본, 제증명 발급, 서명본 다운로드 | `PdfRenderer.render(template_body, field_values, seals[]) → bytes` | 완료본에는 감사 추적 페이지(서명자, IP, UA, 시각, 문서 해시) 추가 권장. Workers 환경이면 외부 렌더러(Browser Rendering 등) 필요 |
| **파일 저장소** | 문서 보관함, 가족 첨부, 도장·사인, 서명자 서명, 완료 PDF, 증명서 PDF | `BlobStore.put/get/delete(key)` + 서명 URL | 10MB 제한, MIME 검증. 주민번호가 담긴 문서라 접근 통제 필수 |
| **본인확인** | `verify/` | `IdentityVerifier.verify(token, payload)` | 방식 미확인(생년월일 대조 / OTP / PASS). OTP라면 SMS 어댑터 필요 |
| **엑셀 생성** | `wage-employees/export/` | `XlsxWriter` | |
| **4대보험 EDI / 신고** | 취득·상실·휴직·복직·피부양자 신고(레거시 `employee_work`) | `InsuranceFilingQueue.enqueue({employee, kind, payload})` | 현행은 세무 담당자가 처리하는 것으로 추정(사람 개입 큐). 자동 EDI는 범위 밖 |
| **ERP(더존·세무사랑) 동기화** | 가입 시 직원 자동 등록, `duzon_input*` | `ErpImporter` | 배치. 범위 밖으로 두고 `source = 'erp_import'`만 기록 |
| **두루누리 지원금 조회** | 국민연금 2차 결정내역, 고용보험 부과고지 조회(20209) | 스크래핑 결과 소비 | M. 현재는 수동 확인 절차 |
| **최저임금·세율 테이블** | R8, R19–R21 | 연도별 상수 테이블 (`/api/tax-rates/*` 재사용 검토) | 법령 개정 시 데이터로 갱신 |
| **nexus 서식 저장소** | `document-form` | 정적 카탈로그 + 파일 URL | 회사 범위 아님, 캐시 가능 |
| **급여 도메인** | 근로조건·근로시간 정책·지급항목(설정), 급여 카드의 `refresh-employee-info` | 같은 DB 내부 참조 | 급여 노트와 FK 계약 합의 필요 |

---

## 7. 미확인 사항

1. **응답 스키마 전반**: 페이지 청크(`index-DmLzoQma.js`, `index-DZ4YnJdg.js`, `index-D68J5BFI.js`, `index-BLCemhGJ.js`, `index-BV2n-M_R.js`, `index-RMXyDszN.js`, `index-Ck4ozqQs.js`, `index-C7032-xv.js`, `VerifyIdentity-*.js`, `SignDocument-*.js`)를 받아 분석해야 필드명이 확정됩니다. 번들 끝의 `sourceMappingURL`로 원본이 공개돼 있는지도 확인할 가치가 있습니다.
2. **전자서명 발송 트리거**: 전용 `/send/` 엔드포인트가 없습니다. POST 생성 시 플래그인지, PATCH로 `status`를 바꾸는지, 이메일 확인 모달의 이메일이 어디로 들어가는지 확인이 필요합니다.
3. **"재발송"**(기한만료 행)의 실제 호출 순서(`revert-to-draft` 뒤 PATCH 발송으로 추정)와 기한 연장 규칙.
4. **서명 기한 N일**, 계약 만료 알림 임계일 N일.
5. **`pending`과 `in_progress`의 경계**: 링크 열람, 본인확인, 문서 일부 서명 중 무엇이 기준인지. 그리고 `in_progress`에서 취소할 수 있는지.
6. **본인확인 방식**(`verify` body)과 세션 수명. 증명서 수령도 같은지.
7. **요청당 수신자 수**: 목록이 수신자 단위 행이므로 1명으로 추정했지만, 다중 수신자 일괄 발송 UI가 있을 수 있습니다.
8. **`EMPLOYEE_STATUS`의 `WORKING`과 `JOINED` 차이**, `count-by-status` 응답 키.
9. **common-info와 wage-employee PATCH의 필드 분담**. common-info가 소득 유형을 가로지르는 "사람" 레코드인지.
10. **기본 급여조건(지급시기·방법·계좌)의 소속** 리소스.
11. **daily/business/other 직원의 생성·조회 경로**(급여 노트의 payroll card 쪽에 있는지)와 필드.
12. **문서 카테고리 코드 값**과 `source_type` 값.
13. **휴직 사유 코드 값**(출산/육아/질병/기타)과 복직 처리 방식(PUT으로 `actual_return_date`?).
14. **퇴직 사유 코드표**: 고용보험 상실사유 코드와 같다는 것은 추정입니다. `employee/leaving-reason/` 응답으로 확인이 필요합니다.
15. **4대보험 신고 실행 주체**: 신규 구성원 정보에서 휴직·퇴직을 저장했을 때 담당자 큐로 가는지, 자동 EDI인지. 레거시 "처리중" 상태가 신규에도 있는지.
16. **R10 고정임금제 산식**: 스크린샷 값이 가산율 1.0과 일치합니다. 급여 노트와 대조해야 합니다.
17. **메뉴 코드**(구성원 정보·전자서명·제증명·설정)와 사용자 권한 그룹별 접근 범위. 세무 담당자(`UserType` 1/2)와 노무대행(51)이 이 API를 쓰는지.
18. **제증명 "표준 취업 규칙"**: 개인 증명서가 아닌데 같은 발급 흐름을 타는지.
19. **템플릿 본문 포맷**(블록 JSON, HTML, DOCX 중 무엇인지)과 필드 바인딩 소스 목록.
20. **도장 삭제 시 참조 무결성**, 근로자 서명 이미지의 보관 범위(요청 단위 / 사람 단위).
21. **레거시 직원 관리 API 전체**(등록·수정·임시저장·신청): 리포트 앱 번들(`src/new-employment/app.ts`, B:102006) 분석이 필요합니다.
