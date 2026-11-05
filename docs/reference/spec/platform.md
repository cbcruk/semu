# 플랫폼·연동 스펙 노트 (계정·회사·권한·결제·계약 / 기관 연동·인증서·외부 서비스 / 홈 부가 기능)

> 대상: 스키마·API 설계자. 근거 표기는 `M:`(매뉴얼 `alfred-manual/` 경로), `B:`(번들 `app-alfred-kr/reverse/index.pretty.js` 줄 번호), `R:`(`routes.tsv`), `D:`(`docs/tax-api-design.md` 절), `S:`(`apps/tax-api/src/db/migrations/0001-init.sql`).
> 표기: **확인** = 번들 코드나 매뉴얼 원문에 그대로 있음, **추정** = 데모 목업·화면·이름에서 유추, **제안** = 재구현 시 설계 제안.
> 기존 설계(`D:1.3`, `D:1.4`, `D:3`, `D:8`)와 어긋나지 않게 확장한다. 특히 `decide()`의 판정 순서(applicable → permission → entitlement → tax terms)는 그대로 쓴다.

---

## 0. 백엔드 지형 (번들에서 확인한 사실)

| 클라이언트 팩토리 | Base URL | 인증 | 이 노트의 모듈 | 근거 |
| --- | --- | --- | --- | --- |
| `createApi$3` → `getApiModules$1` (`useNexusApi`) | `nexus-api.alfred.kr` | 쿠키 세션 + `X-CSRFToken`(쿠키 `nexus_csrftoken`), `withCredentials` | `signup, user, companyUser, company, companyInvitation, passwordChange, terms, external, perm, companyPerm, consult, companyPayment, alfredHome` | B:72370-72407 |
| `createApi$1` → `getApiModules` | `nexus-api.alfred.kr` (`/public/api/*`) | **쿠키 없음**(withCredentials 미설정) | `consult`(공개 상담), `cms`(출금 동의), `termAgreements`(게스트 약관) | B:86669-86690 |
| `createApi$2` → `getApi$2` (`useSfApi`) | `sf-api.alfred.kr` | 쿠키 세션 + XSRF(쿠키 `csrftoken`) | `user`(member/profile, demo), `company`, `companies.hometax`, `join`, `settings`, `lead`, `member.chatChannel`, `subscription`(`/nexus-api/...` 프록시) | B:74709-74740 |
| `createApi` → `getApi` | **`remittance-api.heumtax.com`** | `Authorization: Bearer <회사 JWT>` (`getJWT(companyStore.id)`) | `giro, certificate, transaction, company, integration, partner` | B:89512-89544 |

핵심 정리

- **연동(`/integrations/**`)·인증서(`/cert/**`)·거래처 스크랩(`partner/*`)은 nexus도 sf도 아니고 remittance-api(Bearer JWT)** 로 간다. `reverse/README.md`의 "remittance = 송금" 설명은 좁다. 이 API가 `company_id` claim이 들어간 회사 JWT의 실제 소비자다. 경로의 `:companyId`는 **nexus 회사 ID**다(`useCompanyStore().id`로 JWT를 받음, 화면 호출 인자도 nexus id로 추정).
- sf 호출의 `:companyId`는 `sfCompanyId`. nexus 회사 객체가 `sfCompanyId`를 들고 있고, 회사 선택 시 nexus `GET /api/company/:id/` → sf `GET /api/company/:sfCompanyId/` 순으로 읽는다(B:72548-72576).
- sf 클라이언트가 `/nexus-api/company/:id/subscriptions/`를 부른다(B:74659) → sf가 nexus 구독을 프록시하는 경로가 존재.
- 재구현 제안: 단일 Hono 앱에 세 백엔드를 **경로 접두사로 모으되** 인증 미들웨어는 두 종류로 둔다. (a) 세션 쿠키 + CSRF(nexus/sf 호환), (b) 회사 JWT Bearer(remittance·기존 tax-api 호환). `companies.nexus_company_id`(S:)와 `company_links`(D:3)를 이미 쓰고 있으므로 ID 체계 매핑은 그 테이블로 해결.

---

## 1. 화면과 흐름

### 1.1 진입·가드 순서 (확인, B:104680-104830, R:)

1. `requireAuthGuard`: 비공개 라우트 + 비로그인 → `/login?next=`.
2. `checkHasRequiredConsent`: `GET /api/user/me/term-agreements/?purpose=signup` → 항목마다 `needsConsent` 판정 → 하나라도 필요하면 `/agree-terms?next=`.
3. `checkHasTaxRequiredConsent`: `user.companies.some(c => c.taxPlan === 'taxation')`일 때만 `purpose=tax`로 같은 판정 → `/tax-agree-terms`.
4. `checkHasCompanyGuard`: `user.companies`가 비었으면 sf `GET /api/member/active_invitations/`의 `results.length > 0` ? `/no-company` : `/register-company?showToast=true`.
5. `checkPermissionGuard`: `meta.requiresMenuAccess` 라우트를 메뉴 트리 3뎁스와 매칭 → 없으면 `/dashboard`, 프로모션이면 `promotionUrl`.
6. `checkSystemAdminGuard`: `meta.requiresSystemAdmin`(현재 `/ai-agent`만) + `!isSystemAdmin` → `/dashboard`.
7. 첫 진입 시 `_nexus_company_id`, `_company_id`(sf), `aff` 쿼리 제거(B:77945-77947).

초기화(`initializeUser`, B:105086-105140): `nexus GET /api/user/me/` + `sf GET /api/member/profile/` → **두 email이 다르면 "User Mismatch"로 로그아웃**. 회사 선택 우선순위: 쿼리 `_company_id`(sf id) → 쿼리 `_nexus_company_id` → 쿠키 `SELECTED_COMPANY_ID` → `companies` 마지막 항목. 그 뒤 `localStorage.JWT` 삭제 → JWT 재발급 + 회사 상세/권한/구독 병렬 로드. `isSystemAdmin = companies.find(id).isSystemAdmin`. `isHQAgency = sfCompany.agency.type === 'hq'`.

### 1.2 가입 (셀프)

| 단계 | 화면 | 호출 | 비고 |
| --- | --- | --- | --- |
| 1 | `/signup` (public) | `GET /api/pre-signup/check-email-duplicate/?email=` | ID = 이메일, **변경 불가**(M:08-설정/02) |
| 2 | | `POST /api/pre-signup/send-verification-email/ {email}` | 메일 링크에 토큰 → `:token` |
| 3 | | `POST /api/signup/user/email/:token/ {…}` | body 미확인. 비밀번호·약관 동의 포함 추정 |
| 4 | `/register-company` (`companyNotRequired`) | `GET /api/pre-signup/check/business_number/?business_number=` → `POST /api/signup/company/ {…}` | 사업자번호 중복·유효성(국세청 상태조회 가능성) |
| 5 | `/agree-terms` | `GET /api/terms/?purpose_code=` + `PATCH /api/user/me/term-agreements/` | |
| 대안 | `/auth/kakao-callback` | `POST /api/login/social/ {provider:'kakao', code}` | 응답 상태 `existed_user / duplicated_company / need_to_registration / complete_registration` (B:66598-66602). state/next는 sessionStorage `kakao_oauth_state`, `kakao_oauth_next` |
| 대안 | `/login-overtax` | `GET /api/login/overtax/?token=` | 제휴사(오버택스) SSO 토큰 로그인. 배너 키 `OVERTAX_SIGNUP_BANNER_TYPE_KEY` |
| 대안 | `/external/*` | `/api/external/*` (6.4) | 파트너가 발급한 payload JWT + API key로 회사 연결 |
| 데모 | `/demo` | sf `GET /api/member/demo/` → (추정) 받은 계정으로 `POST /api/login/` | 사용자 `userType=99` |

### 1.3 세무 기장(수임) 가입 — 상담 → 초대 → 계약 (M:11-세무-수임…/01, B:72849-72895)

1. 무료 고객이 상담 신청: 로그인 상태면 nexus `POST /api/company/:id/consult/`, 비로그인/공개면 `POST /public/api/consult`. body(확인, B:86406-86420, 87755-87770):
   `{ name, phone, email, companyName?, consultingPrivacyDate, consultingThirdPartyDate (YYYY-MM-DD), labelIds:[38=TAX|27=PAYROLL], businessNumber, legalForm (35=CORP|34=SOLE), utmSource:'alfred', utmMedium:'product', utmCampaign, utmContent, memo }`. 상담 동의 약관은 `GET /api/terms/?purpose_code=consulting`.
2. 담당자가 **가입 초대 메일** 발송(desk 쪽, 범위 밖). 메일의 [계약서 작성] → `/join?token=` 또는 `/contract-of-bookkeeping`.
3. `/join`(public): `GET /api/join/signup-invitations/:token/existence/` → `POST /api/join/signup-invitations/`(이메일 인증, body 미확인) → `POST /api/join/contracts/:signupSession/ {약관 동의 데이터}` → 이후 `/api/signup/user/invitation/:token/`, `/api/signup/company/:token/`(nexus)로 사용자·회사 생성/연결(추정 순서).
4. 직접 계약(`/contract-of-bookkeeping`, public): `POST /api/join/direct-contract/calculate-fee/ {revenue, employeeNumber, businessType, accountingPeriod, diligentBusiness …}`(enum은 B:72802-72846; 2.12) → `GET /api/join/direct-contract/:contractId/:businessNumber/`(사업자번호 본인 확인) → `POST …/send-sms/:contractId/ {phoneNumber}` → `POST …/verify-sms/:contractId/ {phoneNumber, code}` → `POST …/request-contract-form/:contractId/ {…}` → `POST …/sign-contract/:contractId/ {…}`.
5. 가입 후 고객 할 일: **홈택스 수임동의**(`/hometax/agreement/:agreementId` public, sf `/api/company/hometax/`), **CMS 출금 동의**(`POST /public/api/alfred/withdrawal-consent` 또는 설정 > 계약서 및 동의서에 동의서 업로드), 세무신고 기관 연동, 내역 수집 기관 연동.
6. 회사 `taxPlan='taxation'`이 되면 다음 로그인부터 `/tax-agree-terms` 게이트.

### 1.4 사용자 초대·권한 (M:08-설정/02, 이미지 7a1fd616, 959d0941, 4d0d6d13)

- 관리자만 초대·권한 그룹 CRUD 가능. 일반 사용자는 부여된 메뉴만.
- 초대 모달: `이메일*`, `사용자 권한*` = `일반 사용자 | 관리자`, 일반 사용자면 권한 그룹 다중 선택(칩: 예 `경리 (무료)`, `인사`), 선택 그룹의 메뉴 미리보기(2뎁스 → 3뎁스 목록). → `POST /api/company/:id/internal-invitation/`.
- 목록 탭: `전체 / 가입완료 / 초대완료 / 초대 만료`. 행: 권한 배지, 이메일, 상태(`가입완료`, `초대 완료 — 유효기간 N일 남음`, `초대 만료`), 액션(`초대 취소`, 만료 시 `다시 초대하기`, 가입완료 행은 수정/삭제, 본인 행은 권한 보기). 20개씩 페이지.
- **초대 유효기간 30일**. 취소하면 메일을 열어도 가입 불가. 초대 완료 상태에서 재초대는 "취소 후 재초대"(서버는 활성 초대 중복을 거부해야 함).
- 수락: `/join/internal?token=`(public) → `GET /api/internal-invitation/:token/` → (미가입이면 비밀번호 설정 + 약관) `POST /api/internal-invitation/:token/accept/ {…}`.
- 권한 그룹 편집 화면(이미지 4d0d6d13): `권한 명*` + 2뎁스 그룹 체크(`연동 관리`, `회사 설정`, `증명서`, `세무`, `인사`, `서식`, `매입 관리` …) 아래 3뎁스 칩(`공동 인증서 관리`, `내역 수집 기관 연동`, `세무신고 기관 연동`, `사용자 관리`, `회사 관리`, `증명서 발급`, `법인세`, `부가세`, `원천세`, `연말정산`, `급여관리`, `직원관리`, `서식 모음`, `세금 납부`). 즉 **권한 그룹 = 3뎁스 메뉴 ID 집합**.
- 사용자 권한 = 소속 그룹 메뉴의 **합집합**. 관리자는 전체 메뉴. 세무 수임 고객에서도 관리자는 세무 메뉴 포함 전체, 일반 사용자는 세무 메뉴가 든 그룹이 따로 필요.

### 1.5 회사 정보 (M:08-설정/01, 이미지 0486f9b4)

`/settings/company` 화면 필드(위→아래): 회사명*(읽기 전용), 사업자등록번호*(읽기 전용), 회사 전화번호*, 사업자등록증(파일 다운로드/업로드, 저장 경로 예 `company/345/사업자등록증_2e9ca556.png`), 업종*, 회사주소*(우편번호·기본주소는 주소검색으로만, 상세주소 입력), 근로소득자 급여지급월일(`당월|익월` × `말일|1~31일`), 개인/법인 구분, 법인등록번호, 법인 투자형태(`1.내국|2.외국|3.외투`), 법인 종류(`1.중소기업` … 9종), 법인 설립일, (아래로) 대표자 정보. **회사 정보와 대표자 정보는 한 번에 저장**. 이 화면은 sf `GET/PATCH /api/settings/company/:sfId/`로 추정(첨부는 `attachments` 엔드포인트).

### 1.6 서비스 및 결제 (M:08-설정/10, 이미지 3435ee67, 640b8a52)

- 서비스 카드 3개: `무료 재무 프로그램`(모든 고객 이용중), `세무 아웃소싱`(혜움 기장 수임 고객), `급여 아웃소싱`(주식회사 혜움 급여 계약 고객). 미이용이면 `자세히 보기`, `도입 문의하기`(→ consult).
- 결제 내역 표: `결제 번호`(자체 부여, 비연속 가능), `상품`, `금액`, `결제일`(+`예정` 배지), `결제 상태`, `결제 계좌`(예 `신한 000-000-000000`). 2025-12 기준 **급여 아웃소싱만** 노출. → nexus `GET /api/company/:id/payment/?limit=&offset=`.
- 결제는 **CMS 자동출금**(은행망). 비영업일이면 다음 영업일. 결과는 출금 익일 오후 반영. 결제 1일 전 알림톡으로 예정 금액 안내. 실패 시 담당자가 재시도.

### 1.7 계약서 및 동의서 (M:08-설정/11, 이미지 cd849c25, 63e888a0)

- 탭 `계약서`: 하위 탭 `온라인 수임 계약서`(본문 렌더: 제1조 목적 … 제5조 보수 — 월 기장보수 금액, 조정수수료 시기 법인 3월/개인 5월, 계약기간 1년 자동연장) / `실물 수임 계약서`(파일). → sf `GET /api/settings/company/:sfId/contract/?name=수임계약서|4대보험대행동의약관`.
- 탭 `기장 서비스 자료`: `CMS동의서`(양식 다운받기 + 업로드), `4대보험 업무대행 동의서` 3종 다운로드(건강보험·국민연금·고용보험 — 혜움이 작성), `이전세무자료`(업로드, 예 `.sdb`), `저장하기`. → `GET attachments_form/`(양식), `GET attachments/?name=`, `PUT attachments/`(multipart).
- `AttachmentName`(B:73073): `CMS동의서, 건강보험대행동의서, 고용보험대행동의서, 국민연금대행동의서, 사업자등록증, 이전세무전산자료`. `ContractName`(B:73081): `수임계약서, 4대보험대행동의약관`. 이름 문자열이 그대로 쿼리 값.

### 1.8 기관 연동 화면 (M:08-설정/06, 07; 이미지 7c95a14b, 28cc6436, e42e17fe, 9bcc154f)

- **세무신고 기관 연동**(`/integrate/tax`): 좌측 4단계 상태(`입력 필요 / 정보 추가 / 입력 완료`) — 홈택스(ID/PW), 카드 매출(여신금융협회 ID/PW), 사업용 카드(카드사·카드 종류 선택 → ID/PW, 추가 등록·카드번호 직접 입력/수정), 은행 계좌(빠른조회 계좌 또는 인터넷뱅킹 ID/PW). 세무사 프로그램 연동용이라 **인증서 연동 내역은 세무신고에 못 씀**. 대상: 세무 기장 고객.
- **내역 수집 기관 연동**(`/integrate/transaction`): 섹션별 상태 배지(`연동필요` 등)
  1. 매출/매입 조회 — 홈택스(아이디 | 공동인증서; 인증서면 세금계산서 발급까지), 여신금융협회, 카드사(+카드사 연동하기), 쇼핑몰(올라), 배달(요기요·배민·쿠팡이츠), PG(+PG사 연동하기)
  2. 증빙 발급 — 홈택스 공동인증서(1과 동일, 하나만 하면 됨)
  3. 계좌 조회 — 은행(+은행 연동하기)
  4. 세금 납부 — 인터넷지로(인증서만)
- 카드·은행 연동 두 경로: **인증서로 여러 기관 일괄**(법인/개인 선택 → 기관 다중 체크 → 등록 인증서 선택 + 비밀번호 → 기관별 카드/계좌 체크) vs **ID/PW로 한 기관씩**(기관 + 법인/개인 → ID/PW → 목록에서 선택). 하나·롯데·삼성 **법인카드는 ID/PW만**. 신한은행은 인터넷뱅킹이 아니라 빠른조회 전용 계정.
- 수집 주기(매뉴얼): 은행 등록 후 1일 뒤 확인, PG 매일 10시·22시(최초 익일 10시에 3개월치), 배달 매일 10시경 이전 5일치(최초 90일, 5일 내 취소 반영), 올라 익일 6시부터(최초 1개월), 지원금 매일 04시.
- **인터넷지로**: 인증서 선택(연동 `가능`인 것만) → 비밀번호 → 시도. yessign 외 인증서면 1회 인터넷지로 ID/PW 팝업, 미가입이면 간편 회원가입 팝업(약관 6종 필수: 이용약관, 개인정보 처리방침, 개인(신용)정보 수집·이용, 제3자 제공, 고유식별정보 수집·이용, 인증서 본인 확인 서비스 → 아이디·비밀번호·납부결과 이메일·전화번호). **"아이디, 비밀번호는 혜움에서 저장하지 않습니다"**. → `POST /cert/:id/join/giro`, 이후 `POST /integrations/giro/`.
- **PG**(이미지 a3e0aa5a): PG사 선택 → `PG상점아이디(MID)` + PG별 키. 한 PG사에 단건/정기 계정이 있으면 MID별 각각 등록. `CF_` 접두 토스 MID 불가. 최대 20개(`maxRegisterPgCount: 20`). PG별 필요 키는 2.9.
- **올라**: 새 탭에서 올라 가입/로그인 → 서비스로 돌아와 `[올라 로그인 완료]` → 연동 진행. 지원 SCM 코드 `1`(쿠팡윙)·`11`(쿠팡로켓)·`5`(스마트스토어)(B:90899).

### 1.9 공동인증서 등록 (M:08-설정/08, 15; 이미지 f68e6bf8, 1aa04890)

- `/manage/cert`. 등록에 **로컬 프로그램(InfoTech ExAdapter / iftNxService, Windows 10/11 전용)** 필요. 브라우저 → 로컬 에이전트가 NPKI 인증서를 읽어 암호화 → 서버에 업로드(추정: `POST /cert/` body는 에이전트 산출물).
- 목록 카드: 인증서명, `구분`(예 `개인(은행/카드/보험용)`), `발급기관`(금융결제원 등), `만료일`(만료 D-n), `연결 서비스`(없음 | 연동된 기관들), `삭제하기`.
- 허용 인증서: 개인사업자 = 사업자 명의 범용·전자세금용 또는 개인(대표자) 명의 은행용·범용; 법인 = 법인 명의 은행용·범용·전자세금용. **로그인 사업자/대표자 명의와 불일치하면 등록 불가**.
- 기관별 허용 종류(이미지 1aa04890): 홈택스 = 사업자 범용, 사업자 전자세금용(개인 인증서 불가); 인터넷지로·은행·카드사 = 법인(사업자 은행용, 사업자 범용) / 개인(개인 은행용, 개인 범용 — 지로는 대표자 명의 필수). 은행·카드는 해당 기관 계정에 등록된 인증서여야 함. 발급기관: yessign, signkorea, signgate, crosscert(+KICA, tradesign: OID 목록 B:89563).

### 1.10 외부 서비스 (M:08-설정/09; 이미지 d104bcf7)

- `/integrate/external/:serviceName(shiftee|quotabook)`. 시프티는 payroll 노트(`/api/company/:sfId/payroll/bpo/shiftee-integration` GET/POST/DELETE, sf).
- 쿼타북: `쿼타북 바로가기` + `연동 키 등록` → "Alfred 데이터를 Quotabook에 제공". 번들 엔트리에 쿼타북 API 없음(lazy chunk). 가입 경유 토큰 `QUOTABOOK_SIGNUP_TOKEN_KEY`(B:98493). `/api/external/*`가 쿼타북 같은 파트너의 회사 연결 API일 가능성이 큼(6.4).
- 상담 채널 연동(카카오톡/슬랙): 채널에서 받은 링크 `?action=chat-integration&token=&channel_name=&messenger_type=slack|kakaotalk` → sf `GET /api/member/chat-channel/?token=`(검증) → 회사 선택 → `POST /api/member/chat-channel/ {token, company_id(sf)}`. 오류 `failReason`: `token is invalid | token is used | token is expired`(B:100743-100800).

### 1.11 홈 부가 기능 (AI 비서·지원금 추천)

- **AI 비서**(`/ai-agent`, `requiresSystemAdmin: true`, `hideTopBarAiCommand`): 지금은 **회사의 시스템 관리자만** 진입(라우트 가드 + 메뉴 제외 규칙). 상단바 AI 입력창은 `!isSystemAdmin`이면 숨김(B:99952). 홈의 추천 질문 카드 → sessionStorage `AI_PREFILL_MESSAGE_KEY`로 prefill. 기능(구독별): 무료 = 재무 요약(거래·계좌), 세무·노무 지식 Q&A(RAG, 학습 외 답변 금지), 세금계산서 발행(거래처 + 홈택스 인증서 연동 필요); 세무 기장 = + 증명서 발급 요청, 직원·급여 카드 조회. 대화 목록(사이드바, 새 대화/지난 대화). API는 lazy chunk에만 있어 미확인.
- **지원금 추천**(`/recommend/grant`, `requiresMenuAccess:false`): 좌 `전체 지원금`(현재 신청 가능), 우 `맞춤 추천`(회사 **업종·지역** 매칭, 최대 15개, 업종 불명확하면 업종 무제한). 노출 = 신청 시작 ≤ 오늘 ≤ 마감 또는 상시모집. **매일 04:00 갱신**. 업종 데이터: remittance `GET /api/company/:id/get-business_types`, `POST /update-business_types`(B:89485-89488) 가 후보.

---

## 2. 엔티티와 필드

> 컬럼 타입 규칙은 D:8(STRICT, 금액 INTEGER, 날짜 TEXT KST). 응답은 snake_case(클라이언트가 camel로 변환). 아래 필드명은 camelCase(번들 표기) → 저장은 snake_case.

### 2.1 user

| 필드 | 근거 | 비고 |
| --- | --- | --- |
| `id` | B:72756 `te.user.id` | |
| `email` | 확인 | 로그인 ID, 불변, UNIQUE |
| `userType` | B:66590 | `0 Client, 1 AgencyMember, 2 AgencyManager, 3 Admin, 4 Bot, 51 LaborAgent, 99 DemoClient` (S: users.user_type 이미 존재) |
| `companies[]` | B:72700-72722, 105060-105083 | `{ id(nexus), sfCompanyId, name(추정), taxPlan: 'taxation'|null, isSystemAdmin }` — me 응답에 회사 요약 포함 |
| `password_hash` | 제안 | 8–20자 영문+숫자 (4.1) |
| `name`, `phone` | 추정 | 초대·상담 폼 |
| `marketing_agreed`, `marketing_agreed_at` | M:10-개인-설정 | 개인 설정 "마케팅 정보 수신 동의" 토글. 약관 동의 기록으로 통합 가능(2.6) |
| `kakao_id` 등 소셜 연결 | `/api/login/social/` | 별도 테이블 `user_social_accounts(provider, provider_uid)` 제안 |
| `last_login_at`, `is_active`, `created_at` | 제안 | |

**신규 컬럼(S: users)**: `password_hash TEXT`, `name TEXT`, `phone TEXT`, `is_active INTEGER`, `created_at`, `last_login_at`. 현재 users는 `id,email,user_type,manager_id`뿐.

### 2.2 세션·JWT

- 세션: 쿠키 기반(Django 스타일). 로그인 body `staySignedIn` → 세션 만료 길게(제안: false = 브라우저 세션, true = 14일). CSRF 쿠키 `nexus_csrftoken`/`csrftoken` + 헤더 `X-CSRFToken`.
- **회사 JWT**(확인, B:72445-72465): `POST /api/user/me/jwt/ {company_id}` → `{ token }`. payload 최소 `company_id`, `exp`(unix). 기존 tax-api는 `sub`(user id) 필요(`apps/tax-api/src/middleware/auth.ts`). 제안 claims: `{ sub, company_id(nexus), sf_company_id, user_type, iat, exp(+1h 권장) }`, HS256. 발급 조건: 세션 유효 + 해당 회사 membership(또는 agency_assignments, user_type 3/4).
- 클라이언트는 `localStorage.JWT` 1개만 캐시하고 회사가 바뀌거나 만료되면 재발급. 외부 스크립트용 `window.__CLAIR_GET_JWT`.
- 제안 테이블 `sessions(id, user_id, created_at, expires_at, stay_signed_in, user_agent, ip)` — 쿠키 세션을 DB로 둘 경우.

### 2.3 company (nexus 회사 + sf 회사 설정)

nexus 회사 객체(`GET /api/company/:id/`, B:72495-72520): `id, sfCompanyId, kind (0 Corp | 1 Sole), representativeSet[{ role:'boss', name, … }]`, (+ me의 `taxPlan`). sf 회사(`GET /api/company/:sfId/`): `agency{ type:'hq'|… }` 등.

설정 필드(`/api/settings/company/:sfId/`, 화면 1.5 기준, 추정 키):

| 필드 | 값/제약 |
| --- | --- |
| `name` | 읽기 전용(가입 시 확정) |
| `business_number` | 10자리, 체크섬 검증, 읽기 전용, UNIQUE |
| `phone` | 필수, 전화번호 형식 |
| `business_registration_file` | 첨부(`사업자등록증`) |
| `business_category` (업종) | 필수 자유입력. 지원금 추천 업종 코드는 별도(`business_types`) |
| `zip_code`, `address`, `address_detail` | 필수, 주소검색 API 결과만 |
| `payday_month` (`current`=당월 / `next`=익월), `payday_day` (1–31 / `last`) | 근로소득 급여지급일 |
| `kind` | `0 Corp`, `1 Sole` (S: business_type `corporate/individual`과 매핑) |
| `corporate_number` | 법인등록번호 13자리 |
| `corp_investment_type` | `1 Domestic, 2 Oversea, 3 Foreign` (B:73056) |
| `corp_type` | `1 Small, 2 General, 3 Listed, 4 Unlisted, 5 Public, 6 Nonprofit, 7 AssnReg, 8 OTCBid, 9 OTCUnlisted` (B:73062) |
| `established_on` | 법인 설립일 |
| 대표자 `representatives[]` | `{ role:'boss'|…, name, phone?, birth/rrn?(미확인) }` — 같은 요청으로 저장 |
| `region` | 지원금 추천용(주소에서 시·도 파생 제안) |
| `tax_plan`, `has_payroll_plan` | S:에 존재. 실제 판정은 subscriptions(2.7)로 대체 권장 |
| `agency_id`, `agency_type` | sf `agency.type === 'hq'` → HQ 에이전시 프로모션 메뉴 노출 |

**신규 컬럼(S: companies)**: `kind` 대신 기존 `business_type` 유지 + `phone, business_category, zip_code, address, address_detail, payday_month, payday_day, corporate_number, corp_investment_type, corp_type, established_on, region_code, sf_company_id, agency_id, updated_at`. 신규 테이블 `company_representatives(company_id, id, role, name, phone, …)`, `company_attachments(company_id, name, file_id, uploaded_by, uploaded_at)`(name ∈ AttachmentName, 이력 보존 위해 PK=(company_id,name,uploaded_at) 또는 최신만), `files`(S: 이미 존재 — 재사용).

### 2.4 membership·company user

`GET /api/company/:id/user/` 행(화면 기준, 추정): `{ id(user or membership), email, name, isAdmin|role, roles:[{id,name}], status: 'joined'|'invited'|'expired', invitedAt, expiresAt, isMe }`. 초대 행도 같은 목록에 섞여 나온다(탭 `가입완료/초대완료/초대만료`).

- S: `memberships(company_id, user_id, role IN ('admin','member'))` + `membership_roles` 그대로 사용. 추가 컬럼: `is_system_admin INTEGER`(me.companies[].isSystemAdmin; AI 비서 노출), `joined_at`, `invited_by`.
- `isSystemAdmin`은 "회사 계정 관리자/대표" 의미로 보임 — 관리자(`role='admin'`)와 같은 것인지 별개인지 미확인(7절). 제안: **별개 플래그**(회사당 최초 가입자 1명, 회사 소유자). `/api/external/company_system_admin_list`가 회사별 시스템 관리자 목록을 따로 돌려주는 것도 별개 개념의 근거.
- `PUT /api/company/:id/user/:userId/permissions/` body(추정): `{ is_admin: bool, role_ids: number[] }`.
- `GET …/user/:userId/permission-check/?function=&action=`: 기능 단위 권한 확인(예 function=`payroll`, action=`write`). 메뉴 코드와 별도의 `(function, action)` 축이 서버에 존재 → 7절.

### 2.5 초대

**(a) 내부 초대(회사 사용자 초대)** — 신규 테이블 `internal_invitations`:

| 컬럼 | 비고 |
| --- | --- |
| `id`, `company_id`, `email`, `token`(UNIQUE, 추측 불가 랜덤, 해시 저장 권장) | |
| `is_admin` / `role` | 일반 사용자 \| 관리자 |
| `role_ids` (JSON 또는 `internal_invitation_roles`) | 수락 시 membership_roles로 복사 |
| `status` | `pending | accepted | cancelled | expired` (3.1) |
| `invited_by`, `created_at`, `expires_at`(= created + 30일), `accepted_at`, `accepted_user_id`, `cancelled_at` | |

`GET /api/internal-invitation/:token/` 응답(추정): `{ companyName, email, inviterName, isExistingUser, status, expiresAt }`. accept body(추정): 신규 = `{ password, confirm_password, term_agreements[] }`, 기존 = `{}`(로그인 세션 필요).

**(b) 가입 초대(세무 수임 고객, sf `join`)** — 신규 테이블 `signup_invitations(token, email, company_name?, business_number?, agency_id, contract_id?, status, expires_at, used_at)` + `signup_sessions(id, invitation_token, email_verified_at, agreements JSON, created_at)`. `GET /api/member/active_invitations/` = 로그인 사용자의 이메일로 걸린 미사용 초대 목록(DRF 봉투 `results`) → `/no-company` 화면(초대 수락 대기).

### 2.6 약관·동의 (terms, term agreements)

- `GET /api/terms/?purpose_code=signup|tax|consulting|…` → 약관 목록. 항목(추정): `{ id, code, title, url|content, version, isRequired, purposeCode }`.
- `GET /api/user/me/term-agreements/?purpose=signup|tax` → 항목 배열, 각 항목 형태(확인, B:104689-104696): `{ isRequired, version, history: { isAgreed, version } | null, … }`. 판정: 필수면 `!history.isAgreed || version !== history.version`, 선택이면 `version !== history?.version`(선택 약관도 **새 버전이 나오면 다시 묻는다**). 빈 배열이면 클라이언트가 예외를 던짐 → 서버는 purpose당 최소 1개 약관 보장.
- `PATCH /api/user/me/term-agreements/` body(추정): `{ agreements: [{ term_id|code, version, is_agreed }] }`.
- 게스트 동의 `GET/POST /public/api/terms/agreements {email, purposeCode}` — 비로그인(상담·출금 동의) 동의 기록.
- 무료 고객에게는 세무법인 혜움 약관을 노출하지 않음(M:10-개인-설정) → terms에 `audience`(all | taxation) 컬럼.
- 마케팅 수신 동의 = 선택 약관(purpose `marketing` 또는 signup 선택 항목)으로 모델링 권장.

S: `term_agreements(user_id, term_type IN ('signup','tax'), version, agreed_at)` → 확장 필요:
- 신규 `terms(id, code, purpose_code, title, content_url, version, is_required, audience, effective_from, created_at, UNIQUE(code, version))`.
- `term_agreements`에 `term_code`, `is_agreed`(철회 기록), `ip`, `user_agent`, 게스트용 `email`(user_id NULL 허용) 추가. CHECK의 `term_type` 목록을 `purpose_code` 자유값으로 완화.

### 2.7 구독·플랜

- nexus `GET /api/company/:id/perm/subscription/` == sf `GET /nexus-api/company/:id/subscriptions/` → 배열 `[{ code: 'tax' | 'payroll' | …, isSubscribed: bool, … }]`(확인, B:72522-72545).
  - `hasTaxPlan = some(code==='tax' && isSubscribed)`, `hasPayrollPlan = some(code==='payroll' && isSubscribed)`, `isFree = every(!isSubscribed)`.
- me.companies[].taxPlan === `'taxation'`은 세무 약관 게이트용으로 따로 쓰임 → `subscriptions.tax`와 일관되게 파생(제안: 서버가 같은 소스에서 계산).
- 서비스 카드 매핑: `free`(무료 재무, 항상), `tax`(세무 아웃소싱), `payroll`(급여 아웃소싱).
- 신규 테이블 `company_subscriptions(company_id, code IN ('tax','payroll'), status IN ('active','pending','cancelled','ended'), started_on, ended_on, contract_id, monthly_fee, created_at, updated_at, PRIMARY KEY(company_id, code, started_on))`. 응답 `isSubscribed = status='active' AND started_on<=today AND (ended_on IS NULL OR today<=ended_on)`.
- S: `companies.tax_plan / has_payroll_plan`은 캐시 컬럼으로 두고 구독 변경 트랜잭션에서 갱신하거나 뷰로 대체.

### 2.8 결제(청구)·출금 동의

- `GET /api/company/:id/payment/?limit&offset`(DRF 봉투) 행: `{ id(결제 번호), productName|code('payroll'), amount, paymentDate(출금일), isScheduled, status, account: { bankCode, maskedNumber } }`.
- 상태 enum(매뉴얼): `scheduled(결제 예정) | paid(결제 완료) | failed(결제 실패) | retrying(결제 재시도) | refunded(환불)`.
- 신규 테이블
  - `billing_mandates`(CMS 출금 동의): `company_id, id, bank_code, account_number_enc, account_holder, payer_birth_or_bizno_enc, consent_file_id?, source IN ('upload','online'), status IN ('pending','registered','rejected','revoked'), registered_at`. 온라인 = `POST /public/api/alfred/withdrawal-consent`(body 미확인), 업로드 = AttachmentName `CMS동의서`.
  - `payments`: `company_id, id(INTEGER AUTOINCREMENT, 비연속 허용), subscription_code, amount, scheduled_on, attempted_on, settled_at, status, mandate_id, failure_reason, refunded_at, parent_payment_id(재시도 원건)`. 
  - `payment_events(payment_id, type, actor, created_at)`.
- 규칙: 비영업일이면 다음 영업일(S: `public_holidays` 재사용), 결과는 출금일 익일 오후 배치로 반영, 출금 D-1 알림톡.

### 2.9 연동(integration) — 유형별

공통 enum(B:89170-89192): `IntegrationType = hometax | giro | cardsales | bank | creditcard | allra | speedbank | pg | delivery`. 목록 `GET /integrations/v2/?integration_type=` 응답(데모 목업 B:90955-91060)은 **유형마다 모양이 다르다**:

```jsonc
{
  "hometax":   { "certInfo": { "id", "certificate": Cert, "lastScrapStatus": ScrapStatus, "created", "modified" } | null,
                 "accountInfo": { "id", "accountId", "lastScrapStatus", … } | null,
                 "lastHometaxScrapRequestStatus": ScrapRequest | null },
  "giro":      { "giroInfo": { "id", "certificate": Cert, "lastScrapStatus" }, "lastGiroScrapRequestStatus" },
  "cardsales": { "cardsalesInfo": { "id", "accountId", "lastScrapStatus" }, "lastCardsalesScrapRequestStatus" },
  "creditcard":{ "cards": [CardIntegration], "maxRegisterCreditcardCount": 20, "lastCreditcardScrapRequestStatus" },
  "bank":      { "banks": [BankIntegration], "maxRegisterBankAccountCount": 20, "lastBankScrapRequestStatus" },
  "allra":     { "allraInfo": { "id", "lastScrapStatus", "scmList": [{ "id","code","name","isScrapAvailable","integrationId","lastScrapStatus" }] }, "lastAllraScrapRequestStatus" },
  "speedbank": { "speedbanks": [] },
  "pg":        { "pgs": [], "maxRegisterPgCount": 20, "scrapRequest": null },
  "delivery":  { "deliveryList": [], "maxRegisterDeliveryCount": 20, "scrapRequest": null }
}
```

- `Cert` = `{ id, oid, isActive, certName, orgName, pubDate, endDate }`(B:89743-89768).
- `ScrapStatus`(마지막 수집 결과) = `{ id, company, status: 'success'|…, code, message, messageContent, isInitial, isScrapAvailable?, created, modified }`.
- `CardIntegration` = `{ id, creditcardCode, isCorporate, certificate?: Cert, accountId?: string, cardList: [{ id, integrationId, cardName, cardNumber, maskedCardNumber, isScrapAvailable, lastScrapStatus, created, modified }] }` — 인증서 연동이면 `certificate`, ID/PW면 `accountId`.
- `BankIntegration` = `{ id, bankCode, isCorporate, isActive, certificate?|accountId?, accountList: [{ id, integrationId, accountName, accountNumber, accountType, openDate, endDate, balance, currencyCode, isDormant, holder, lastTransactionDate, isScrapAvailable, lastScrapStatus, isActive, externalKey, isVisibleOnCashReport }] }`.
- 상태 화면 `GET /integrations/status/?integration_type=` → `integrationStatus[type]` 배열. 항목: hometax `{ authType: 'ID'|'CERTIFICATE', certificate: CertificateStatus, lastScrapping: { isRetryable, … } }`, bank `{ isActive, certificate, accounts:[{ isActive, lastScrapping }] }`, creditcard `{ accounts:[…] }`, allra `{ scm:[{ lastScrapping }] }`, 나머지 `{ certificate?, lastScrapping }`(B:91790-91900). `CertificateStatus = ACTIVE | EXPIRED | INACTIVE | UNREGISTERED`.

| 유형 | 인증 방식 | 등록 요청 키(확인/추정) | 비고 |
| --- | --- | --- | --- |
| `hometax` | `ID`(ID/PW: 조회만) 또는 `CERTIFICATE`(발급 가능). 둘 다 공존 가능 | `POST /integrations/hometax/` body 추정 `{ auth_type, account_id, account_pw }` 또는 `{ auth_type, cert_id, sign_pw }`; 120s timeout | `DELETE /integrations/hometax/:id/`. 세무신고용 홈택스 ID/PW도 같은 레코드인지 미확인 |
| `cardsales` | 여신금융협회 ID/PW | `{ account_id, account_pw }`(확인 B:89201) | 오프라인 카드매출 |
| `creditcard` | 인증서(일괄) 또는 ID/PW(카드사별) | 1) `POST creditcard/request-card-list {card_codes[], is_corporate, cert_id+sign_pw | account_id+account_pw}`(120s) → 카드 후보 2) `POST creditcard/ {선택 카드…}` 3) `PUT creditcard/:integrationId/:cardId {card_number}` 카드번호 보정 | `CreditCardCode` 001–020 (B:90244) |
| `bank` | 인증서(일괄) / ID/PW / 빠른조회 | `POST bank/request-bank-list`(120s) → `POST bank/` → `PATCH bank/accounts`(계좌 on/off·표시 여부 추정) | `BankCode` 002–103 (B:89899), `AccountType` 01 요구불·02 적금·11 신탁·21 펀드·31 외화골드·41 대출·51 보험공제·61 연금 |
| `speedbank` | 은행 빠른조회 계정 | `POST speedbank/`, `PATCH speedbank/:id/`, `DELETE` (120s) | 세무신고용 계좌(세무사 프로그램 연동) |
| `giro` | 인증서만 | `POST cert/:certId/join/giro {회원가입 정보}` → `POST integrations/giro/ {cert_id, sign_pw?, giro_id?, giro_pw?}` | 지로 ID/PW **저장 금지** |
| `pg` | MID + PG별 키 | `POST pg/ {pg_company, mid, …keys}`(120s) | 2.9.1 |
| `delivery` | 배달앱 ID/PW | `POST delivery/ {delivery_corp, account_id, account_pw}`(120s) → 매장(store) n개 | `DeliveryCorp = baemin | coupangeats | yogiyo`; 삭제는 store 단위 `DELETE delivery/store/:storeId/` |
| `allra` | 외부 서비스(올라) 계정 | 올라 OAuth/콜백(미확인) | SCM 코드 1·11·5 |

#### 2.9.1 PG별 자격 증명 (M:08-설정/07/05)

`PgCompany`(B:89181): `NICEPAY{mid, usrId(상점관리자 ID), merchantKey}`, `TOSSPAYMENTS{mid, secretKey}`, `TOSSPAY{mid, apiKey}`, `UPLUS(토스 구 유플러스){mid, mertKey}`, `NAVERPAY(결제형){mid, settlementApiKey, clientId, clientSecret, chainId}`, `HECTO{mid, licenseKey}`, `INICIS{mid(=관리자 ID), reconciliationPassword}`, `EXIMBAY{mid, secretKey}`, `KSNET{mid, reconciliationApiKey}`. 이니시스·나이스는 **사전 IP 화이트리스트(52.78.5.241)** 등록 필요 → 재구현 시 고정 egress IP 필요.

#### 2.9.2 저장 모델 (제안)

- `integrations(company_id, id, type, sub_code(카드사/은행/PG/배달사 코드), auth_type IN ('id','certificate','speedbank','api_key','oauth'), is_corporate, certificate_id NULL, account_id_masked, credential_ref, status IN ('active','inactive','error','deleted'), last_scrap_status_id, created_at, modified_at, UNIQUE(company_id,id))`.
- `integration_credentials(id, integration_id, ciphertext BLOB, key_version, created_at)` — **ID/PW·PG 키·서명 비밀번호는 봉투 암호화**(4.6). 응답에 원문 비노출, `accountId`만 평문(또는 마스킹).
- `integration_items`(카드·계좌·매장·SCM): `company_id, id, integration_id, kind IN ('card','account','store','scm'), external_key, name, number_enc, masked_number, account_type, currency, is_active, is_visible_on_cash_report, meta JSON`.
- 한도: 카드·계좌·PG·배달 각 20(`max…Count`) — 서버 검증.

### 2.10 스크랩 요청·상태

- `ScrapRequestStatus = request | done | timeout`(B:89228). `GET /integrations/:service/last-scrap-request-status` 응답(데모 B:91137-91170): `{ id, company, service, requester: 'user'|'system', code, message, status, isInitial, canScrapping, remainSeconds, created, modified }` → **수동 수집 쿨다운**(`canScrapping=false`, `remainSeconds`).
- `POST /integrations/request-scrapping/:service {corporation_number_unused: bool, …}` → 같은 모양 반환. `corporationNumberUnused`는 홈택스에서 법인번호 미사용 조회 옵션으로 추정.
- `POST /integrations/request-all-scrapping/`: 전체 재수집. `GET /integrations/scraping-status/?id=` → `ScrappingStatus = PROGRESS | SUCCESS | FAIL`(폴링, store `timeoutId`).
- 재시도 가능성(`isRetryable`) 규칙은 3.2.
- S: `scrap_requests(company_id, service, status, requested_at, finished_at)` → 추가 컬럼 `id TEXT PK`, `requester`, `code`, `message`, `is_initial`, `integration_id`, `item_id`, `options JSON`, `next_available_at`(쿨다운 → `remainSeconds` 계산). 신규 `scrap_results(company_id, id, integration_id, item_id, status IN ('success','fail','progress'), code, message, message_content, is_initial, is_retryable, created_at)` = `lastScrapStatus`/`lastScrapping` 원천.

### 2.11 공동인증서

- 목록 `GET /cert/?detail=true` → `Cert[]` + (detail) 연결 서비스 목록 추정 `linkedServices: IntegrationType[]`, 상태 `CertificateStatus`.
- `POST /cert/` body = 로컬 에이전트 산출물(추정 `{ cert_der_b64, key_enc_b64, sign_pw_enc }`). `POST /cert/:id/password_check {sign_pw}` → 비밀번호 검증(연동 전 단계). `DELETE /cert/:id`.
- 분류 축: `type: personal | business`, `usage: general(범용) | bank/card/insurance(은행·카드·보험용) | etax(전자세금용)`, `organizationCode: yessign | signkorea | signgate | crosscert | KICA | tradesign`, `oid`(B:89563-89740 매핑 테이블 — 서버도 같은 OID 표로 분류).
- 신규 테이블 `certificates(company_id, id, subject_dn, cert_name, oid, cert_type, usage, organization_code, serial, pub_date, end_date, owner_business_number?, owner_name, is_active, status, cert_blob_enc, key_blob_enc, sign_pw_enc, registered_by, created_at, deleted_at, UNIQUE(company_id,id), UNIQUE(company_id, serial))`. `status`는 저장 + `end_date < today → EXPIRED` 파생.

### 2.12 계약(기장)·직접 계약

- `calculate-fee` 입력 enum(확인 B:72798-72846): `Revenue`(개인 `sole_under_50m … sole_over_20b` 10단계, 법인 `corp_under_300m … corp_over_20b` 10단계), `EmployeeNumber(under_10, from_10_to_20, from_21_to_30, from_31_to_50, above_50)`, `BusinessType(etc, construction, manufacturing, trade, lending, other_professional_service)`, `AccountingPeriod(annual, semi_annual, quarterly, monthly)`, `DiligentBusiness(no, yes)`(성실신고 대상). 출력(추정) `{ monthlyFee, adjustmentFee, … }` — 계약서 제5조 "월 350,000원(VAT 별도)"처럼 들어감.
- 신규 테이블 `bookkeeping_contracts(id, company_id NULL(가입 전), business_number, representative_phone, fee_inputs JSON, monthly_fee, adjustment_fee_rule, status (3.4), sms_verified_at, form_requested_at, signed_at, signature_file_id, contract_file_id, kind IN ('online','paper'), effective_on, auto_renew INTEGER, agency_id)`, `sms_verifications(id, purpose, target_id, phone, code_hash, expires_at, attempts, verified_at)`.
- 설정 화면 `contract/?name=수임계약서`는 이 테이블에서 렌더(온라인) 또는 파일(실물).

### 2.13 상담·리드·공유

- 회사 상담 `POST /api/company/:id/consult/` / 공개 상담 `POST /public/api/consult`: 1.3의 body. 신규 `consult_leads(id, company_id NULL, user_id NULL, name, phone, email, company_name, business_number, legal_form_label, label_ids JSON, memo, privacy_agreed_on, third_party_agreed_on, utm_source, utm_medium, utm_campaign, utm_content, status IN ('new','contacted','closed'), created_at)`. 접수 후 카카오 알림톡 안내(이미지 f012cdb3: "신청이 완료되면 카카오톡으로…"), 1–2영업일 내 연락.
- 온라인 리드(sf) `POST /api/lead/online?timestamp= {…, lead_type:'biz', utm_source:'alfred', utm_medium:'web', agree_to_marketing:false, marketing_agreement_date:null}` 후 `PATCH /api/lead/online?timestamp=`로 단계별 보강 → **`timestamp`가 리드 식별 키**(같은 세션의 리드를 갱신). `online_leads(timestamp_key UNIQUE, …)`.
- 거래처 공유 `POST /partner/share-company/send {…}`(remittance): 우리 회사 정보를 거래처에게 보내기(수신 채널·body 미확인), `GET /share-histories/recent`. `GET /partner/scrap/business-status?business_number=` → 국세청 사업자 상태(계속/휴업/폐업, 과세유형) 조회 프록시.

### 2.14 메뉴·권한 그룹·즐겨찾기

- `GET /api/perm/menus`: 전체 권한 대상 메뉴 카탈로그(권한 그룹 편집 화면의 2뎁스/3뎁스 체크 트리). `GET /api/perm/roles`: 시스템 기본 권한 템플릿(예 `경리 (무료)`, `인사`)으로 추정.
- `GET/POST/PATCH/DELETE /api/company/:id/perm/role/…`: 회사 권한 그룹. body(추정) `{ name, menu_ids: number[] }`. `GET …/role/:id/company-users` → 그룹 삭제 확인 모달에서 소속 사용자 표시.
- `GET /api/company/:id/user/me/menus/` → `accessiblePermissions`(라우트 가드가 truthy 여부만 봄; 3뎁스 메뉴 접근 목록 추정). `GET /api/company/:id/menus/` → 회사가 쓸 수 있는 메뉴(플랜 반영) 추정.
- 메뉴 트리 노드: D:1.3 `{ id, name, code, category, accessiblePermissions, isFavoritable, isFavorite, favoritedAt, isPromotion, promotionUrl, icon, to, children }`. 최상위 `name === 'header'` 섹션(상단바 링크), `name === '설정'` 섹션(설정 LNB). 개인 설정 노드는 클라이언트 고정(id 99990–99994).
- 즐겨찾기 `POST …/user/me/menus/favorites/ {menu_id}`, `DELETE …/favorites/:menuId/`. 신규 `menu_favorites(company_id, user_id, menu_id, created_at, PK(company_id,user_id,menu_id))`. `isFavoritable=false` 노드는 422.
- S: `perm_roles.menu_codes`(JSON) 존재 → 클라이언트는 **숫자 `menuId`** 를 쓰므로 `menus(id INTEGER PK, code UNIQUE, parent_id, depth, name, path, …)` 정규 테이블을 추가하고 `perm_roles`는 `perm_role_menus(company_id, role_id, menu_id)`로 정규화 권장(또는 menu_codes 유지 + id↔code 매핑). 시스템 템플릿 역할은 `perm_roles.company_id NULL` + `is_template`.

### 2.15 외부 파트너 연결 (`/api/external/*`, nexus)

- `PayloadState = INTEGRATED | EXISTS_COMPANY | NO_COMPANY`(B:66717).
- `GET validate_payload` (헤더 `Authorization: Bearer <partner payload JWT>`) → `{ state, businessNumber?, companyName?, … }`.
- `GET company_system_admin_list` (같은 Bearer) → 해당 사업자번호 회사의 시스템 관리자 이메일(마스킹) 목록 → `/external/connect-account`.
- `POST attach` (헤더 `X-API-KEY`) `{ email, password, business_number }` → 기존 계정으로 로그인 + 회사 연결.
- `POST join-company` (헤더 `X-API-KEY`) `{…}` → 신규 회사 등록(`/external/register-company`).
- 신규 `partner_clients(id, name, api_key_hash, jwt_secret|public_key, allowed_scopes, created_at)`, `partner_company_links(partner_id, company_id, external_ref, linked_by, linked_at, status)`.

### 2.16 홈 부가 기능 (제안 모델)

- AI 비서: `ai_conversations(company_id, id, user_id, title, created_at, updated_at)`, `ai_messages(conversation_id, id, role IN ('user','assistant','tool'), content, tool_calls JSON, created_at)`, `ai_tool_audit(…)`(세금계산서 발행·증명서 요청 같은 쓰기 도구는 실행 전 확인 단계 + 감사 로그). 도구 허용은 `decide()`와 구독(`tax`)으로 판정.
- 지원금: `grants(id, source, source_id UNIQUE, title, agency, region_codes JSON, industry_codes JSON, apply_start_on, apply_end_on NULL(상시), url, summary, fetched_at)`, `company_grant_recommendations(company_id, grant_id, score, rank ≤ 15, computed_at)`. 04:00 배치.
- 상담 채널: `chat_channel_tokens(token UNIQUE, messenger_type IN ('slack','kakaotalk'), channel_name, expires_at, used_at, company_id)`.

---

## 3. 상태와 전이

### 3.1 내부 초대

```
pending ──accept(token, 미만료)──▶ accepted   (membership 생성 + role 복사, 동일 이메일 기존 사용자면 연결)
pending ──cancel(관리자)─────────▶ cancelled  (토큰 무효, 이후 accept → 410)
pending ──now > expires_at──────▶ expired    (조회 시 파생 or 배치)
expired ──reinvite(관리자)──────▶ pending    (새 token, expires_at = now+30d; 같은 행 갱신 or 새 행)
```
- 불변식: `(company_id, lower(email))`당 `pending` 1개(부분 UNIQUE 인덱스). 이미 멤버인 이메일 초대 → 409.
- 표시 상태 매핑: accepted→`가입완료`, pending→`초대 완료(D-n)`, expired→`초대 만료`.

### 3.2 연동·수집

연동 레코드:
```
(none) ──register(검증 성공)──▶ active ──자격 증명 오류/인증서 만료──▶ error(certificate: EXPIRED|INACTIVE)
active ──delete──▶ deleted (항목·수집 이력은 보존, 자격 증명은 즉시 파기)
error ──재등록/인증서 교체──▶ active
```
수집 요청:
```
request ──worker 완료──▶ done      (결과: scrap_results.status success|fail)
request ──시간 초과────▶ timeout
```
- 진행 표시 `ScrappingStatus`: 하나라도 request면 `PROGRESS`, 모두 done이고 실패 없음 `SUCCESS`, 아니면 `FAIL`(추정).
- `canScrapping=false` 동안 수동 요청 → 429 + `remainSeconds`.
- 재시도 가능(`isRetryable`, 클라이언트 규칙 B:91826-91900): hometax는 ID 연동이 없고 인증서가 EXPIRED/INACTIVE면 불가, ID+인증서 둘 다면 ID 쪽 `lastScrapping.isRetryable`, 하나면 그 값(없으면 true); giro·bank는 인증서 EXPIRED/INACTIVE면 불가, bank는 비활성 계좌 제외; cardsales·delivery는 lastScrapping 없으면 true; pg·allra는 값 그대로. → 서버가 `is_retryable`를 결과에 계산해 내려준다(인증서 비밀번호 오류·계정 잠김 등은 false).
- 인증서 상태: `UNREGISTERED`(연동은 있으나 인증서 삭제) / `ACTIVE` / `EXPIRED`(end_date 경과) / `INACTIVE`(기관에서 폐기·비밀번호 변경 감지).

### 3.3 구독·결제

```
subscription: pending(계약 체결, 시작 전) → active → cancelled(해지 예약) → ended
payment:      scheduled → paid
              scheduled → failed → retrying → paid | failed
              paid → refunded
```
- `failed→retrying`은 담당자(desk) 액션. 결과 반영은 출금 익일 오후 배치(CMS 결과 파일).

### 3.4 기장 계약(직접 계약)

```
draft(fee 계산) → identity_verified(사업자번호 확인) → sms_verified → form_requested → signed → active(구독 tax 시작)
any(before signed) → expired (링크 유효기간, 미확인)
```
가입 초대: `issued → email_verified(signup_session 생성) → agreed(contracts/:signupSession) → completed(user/company 생성)`; `issued → expired|revoked`.

### 3.5 상담 채널 토큰 / 외부 payload

`issued → used`(POST 성공) | `expired`. 오류 문자열은 `token is invalid|used|expired` 그대로(클라이언트가 문자열 매칭).

---

## 4. 규칙

### 4.1 비밀번호
- 8–20자, 영문(대소문자 무관) + 숫자 각 1자 이상(B:96790-96791 `validatePasswordLength`, `validatePasswordCombination`; 공통 메시지 "8자 이상 20자 이하의 영문, 숫자 혼용"). `password === confirm_password` 서버도 검증. 공백 금지(`noSpace`) 제안.
- 변경 성공 후 클라이언트는 `/login`으로 보냄 → 서버는 **변경 시 다른 세션 전부 무효화**.
- 재설정: `POST /api/request-password-change-email/:email/` — 계정 존재 여부와 무관하게 202(열거 방지), 토큰 1회용·만료(제안 30분). `GET /api/password-change/:token` 유효성(404/410), `POST …/:token/ {password, confirm_password}`.
- 데모 사용자(99)는 비밀번호 변경 불가(클라이언트 `isDemoUserType` 가드 → 서버 403 `DEMO_READ_ONLY`, D:3).

### 4.2 JWT 재발급
- 클라이언트 유효성: `String(payload.company_id) === String(companyId) && now < exp`. 서버는 회사 접근권 재확인 후 발급. 회사 전환·만료마다 호출되므로 rate limit 완화. tax-api 검증 규칙(D:3 `COMPANY_MISMATCH`) 유지.
- `company_id` 타입: 클라이언트가 문자열 비교 → 숫자/문자 모두 허용.

### 4.3 데모 로그인
- `/demo` → `GET /api/member/demo/`가 공유 데모 계정(또는 1회용 계정) 자격을 돌려주는 것으로 추정. 데모 화면 데이터는 **클라이언트 목업**(`createDemoApi`: 연동은 모두 성공·ACTIVE로 덮어씀, B:91069-91170). 서버는 데모 사용자 쓰기 전부 403.

### 4.4 메뉴 노출 (플랜 × 권한)
- 서버 `decide()`(D:3)에 클라이언트 규칙을 흡수:
  1. 프로모션 노드는 `company.isFree`일 때만 노출. 예외: `pb_employment`, `pb_payroll_management`는 HQ 에이전시 회사(sf `agency.type === 'hq'`)에도 노출(B:77617-77630).
  2. 구독 `payroll`이면 `employee_management` 숨김(B:77551).
  3. `/ai-agent`는 `isSystemAdmin`만(B:77553).
  4. 자식이 모두 빠진 2뎁스·1뎁스 노드는 제거.
- 매뉴얼 기준 플랜별: 인사 > 구성원 정보·급여 > 급여 정산 = `payroll` 구독(또는 payroll+tax), 인사 > 직원 관리·급여 > 급여 관리 = `tax`만, 세무 메뉴 = `tax`, 전자서명·제증명·급여 설정 = `payroll`, 계약서 및 동의서 = `tax`, 기관 연동·인증서·회사·사용자·지원금·AI = 전체.
- 관리자 = 회사에서 적용 가능한 전체 메뉴, 일반 사용자 = 그룹 합집합. `회사 설정 > 사용자 관리`를 가진 일반 사용자라도 **초대·권한 CRUD는 관리자 전용**(매뉴얼 표) → 별도 체크.
- 관리자는 다른 관리자 권한도 회수 가능. 마지막 관리자 강등/삭제는 409(제안).

### 4.5 시스템 관리자
- `me.companies[].isSystemAdmin`(회사별). 용도: AI 비서, `/api/external/company_system_admin_list`. 운영자 `user_type=3`과 다른 개념.

### 4.6 자격 증명 암호화
- 저장 대상: 홈택스/여신협회/카드사/은행/배달/빠른조회 ID·PW, PG 키(secretKey, merchantKey, apiKey, mertKey, clientSecret, licenseKey, reconciliation*), 인증서 개인키·서명 비밀번호, 계좌·카드 전체 번호, CMS 출금 계좌·생년월일.
- 봉투 암호화(AES-256-GCM, 데이터 키는 KMS/환경 마스터 키로 래핑, `key_version` 회전). 응답에 원문 금지, 로그·Sentry 마스킹. 지로 ID/PW는 **저장 금지**(매뉴얼 명시) — 가입 요청 시 어댑터로만 전달.
- 인증서 업로드는 로컬 에이전트가 이미 암호화한 페이로드 → 서버는 복호화 키를 수집 워커 경계 안에만 둔다.

### 4.7 기타
- 사업자번호·법인번호·주민번호 체크섬 검증(클라이언트 메시지 `bizNumber/corpNumber/regNumber`). 
- 인증서 명의 일치: 개인 = 로그인 사업자 또는 대표자 명의, 법인 = 법인 명의. 기관별 허용 `usage`(1.9) 위반 → 422 `CERT_NOT_ALLOWED_FOR_SERVICE`.
- 이메일은 대소문자 무시 UNIQUE.
- 회사 생성 시 생성자 = `admin` + `is_system_admin`, 기본 무료 구독 상태.

---

## 5. 엔드포인트 표

열: 동사 · 정규화 경로 · 번들 메서드 · 용도 · 요청 키 · 응답(확인/추정) · 백엔드 · 위치(B:). `:cid` = nexus 회사 id, `:sid` = sf 회사 id. remittance 경로 접두사 `/api/company/:cid`는 `R…`로 줄임.

### 5.1 인증·계정 (nexus 쿠키 세션)

| # | 동사 | 경로 | 메서드 | 용도 | 요청 | 응답 | BE | B: |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | POST | `/api/login/` | `user.postLogin` | 이메일 로그인 | `email, password, stay_signed_in` | 세션 쿠키; 추정 `{user}` | nexus | 66604 |
| 2 | POST | `/api/login/social/` | `user.postSocialLogin` | 카카오 로그인 | `provider, code` | `{status: existed_user|duplicated_company|need_to_registration|complete_registration, …}` | nexus | 66606 |
| 3 | GET | `/api/login/overtax/` | `user.loginWithOvertax` | 제휴 SSO | `?token` | 세션 쿠키 | nexus | 66608 |
| 4 | POST | `/api/logout/` | `user.postLogout` | 로그아웃 | – | 204 | nexus | 66610 |
| 5 | GET | `/api/user/me/` | `user.getMe` | 내 정보 | – | `{id, email, userType, companies[{id, sfCompanyId, name, taxPlan, isSystemAdmin}]}` | nexus | 66603 |
| 6 | POST | `/api/user/me/jwt/` | `user.postGenerateJWT` | 회사 JWT | `company_id` | `{token}` | nexus | 66611 |
| 7 | PATCH | `/api/user/me/password-change/` | `user.patchPasswordChange` | 비밀번호 변경 | `password, confirm_password` | 204 | nexus | 66613 |
| 8 | GET | `/api/user/me/term-agreements/` | `terms.getTermAgreements` | 동의 현황 | `?purpose=signup|tax` | `[{isRequired, version, history:{isAgreed, version}}…]` | nexus | 66708 |
| 9 | PATCH | `/api/user/me/term-agreements/` | `terms.patchTermAgreements` | 동의 저장 | 추정 `agreements[{term_id, version, is_agreed}]` | 갱신 목록 | nexus | 66710 |
| 10 | GET | `/api/terms/` | `terms.getTerms` | 약관 목록 | `?purpose_code=` | `[term]` | nexus | 66707 |
| 11 | GET | `/api/password-change/:token` | `passwordChange.getToken` | 재설정 토큰 확인 | – | 200/404 | nexus | 66694 |
| 12 | POST | `/api/password-change/:token/` | `passwordChange.postPasswordChange` | 비밀번호 재설정 | `password, confirm_password` | 204 | nexus | 66695 |
| 13 | POST | `/api/request-password-change-email/:email/` | `passwordChange.postRequestChangeEmail` | 재설정 메일 | (경로에 이메일) | 202 | nexus | 66700 |
| 14 | GET | `/api/pre-signup/check/business_number/` | `signup.getCheckBusinessNumber` | 사업자번호 확인 | `?business_number` | 추정 `{isValid, isDuplicated, status}` | nexus | 66562 |
| 15 | GET | `/api/pre-signup/check-email-duplicate/` | `signup.getCheckIdDuplicate` | 이메일 중복 | `?email` | 추정 `{isDuplicated}` | nexus | 66567 |
| 16 | POST | `/api/pre-signup/send-verification-email/` | `signup.postSendEmailVerification` | 인증 메일 | `email` | 202 | nexus | 66569 |
| 17 | POST | `/api/signup/user/email/:token/` | `signup.postCreateUserByEmail` | 이메일 인증 후 가입 | 미확인(password, agreements…) | user + 세션 | nexus | 66571 |
| 18 | POST | `/api/signup/user/invitation/:token/` | `signup.postCreateOrConnectUserByInvitation` | 초대로 가입/연결 | 미확인 | user | nexus | 66573 |
| 19 | POST | `/api/signup/company/` | `signup.postCreateCompany` | 회사 등록 | 미확인(name, business_number, kind, …) | company | nexus | 66566 |
| 20 | POST | `/api/signup/company/:token/` | `signup.postCreateCompanyByInvitation` | 초대 기반 회사 등록 | 미확인 | company | nexus | 66575 |
| 21 | GET | `/api/external/validate_payload` | `external.getPayloadValidity` | 파트너 payload 검증 | `Authorization: Bearer` | `{state: INTEGRATED|EXISTS_COMPANY|NO_COMPANY, …}` | nexus | 66723 |
| 22 | GET | `/api/external/company_system_admin_list` | `external.getAdminAccounts` | 회사 시스템 관리자 목록 | Bearer | `[{email(masked)}]` 추정 | nexus | 66727 |
| 23 | POST | `/api/external/attach` | `external.postAttachCompany` | 기존 계정으로 파트너 연결 | `X-API-KEY`; `email, password, business_number` | 추정 연결 결과 | nexus | 66731 |
| 24 | POST | `/api/external/join-company` | `external.postJoinCompany` | 파트너 경유 신규 등록 | `X-API-KEY`; 미확인 | 추정 company | nexus | 66737 |
| 25 | POST | `/public/api/consult` | `consult.postConsultLead` | 공개 상담 신청 | 1.3 body | 201 | nexus-public | 86668 |
| 26 | POST | `/public/api/alfred/withdrawal-consent` | `cms.registerBillingInfo` | CMS 출금 동의 | 미확인(계좌·예금주·생년월일/사업자번호·동의) | 201 | nexus-public | 86670 |
| 27 | GET | `/public/api/terms/agreements` | `termAgreements.getGuestAgreements` | 게스트 동의 조회 | `?email, purpose_code` | 목록 | nexus-public | 86673 |
| 28 | POST | `/public/api/terms/agreements` | `termAgreements.postGuestAgreements` | 게스트 동의 저장 | 미확인 | 201 | nexus-public | 86677 |

### 5.2 가입 계약·멤버 (sf)

| # | 동사 | 경로 | 메서드 | 용도 | 요청 | 응답 | BE | B: |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 29 | GET | `/api/member/profile/` | `user.getProfile` | sf 프로필(이메일 일치 확인) | – | `{email, …}` | sf | 72773 |
| 30 | GET | `/api/member/demo/` | `user.getDemoAccount` | 데모 계정 | – | 추정 `{email, password}` | sf | 72774 |
| 31 | GET | `/api/member/active_invitations/` | `join.getHasActiveInvitations` | 내 미수락 초대 | – | `{results:[…]}` | sf | 72859 |
| 32 | GET | `/api/member/chat-channel/` | `member.chatChannel.get` | 상담 채널 토큰 검증 | `?token` | 채널 정보 / 4xx `{failReason}` | sf | 74644 |
| 33 | POST | `/api/member/chat-channel/` | `member.chatChannel.post` | 상담 채널 연결 | `token, company_id(sf)` | 201 | sf | 74650 |
| 34 | GET | `/api/join/signup-invitations/:token/existence/` | `join.getTokenVerified` | 가입 초대 유효 | – | 200/404 | sf | 72849 |
| 35 | POST | `/api/join/signup-invitations/` | `join.postEmailVerified` | 초대 이메일 인증 | 미확인(token, email) | 추정 `{signupSession}` | sf | 72853 |
| 36 | POST | `/api/join/contracts/:signupSession/` | `join.postAgreements` | 가입 약관·계약 동의 | 미확인 | – | sf | 72855 |
| 37 | POST | `/api/join/direct-contract/calculate-fee/` | `join.postCalculateFee` | 기장료 계산 | `revenue, employee_number, business_type, accounting_period, diligent_business`(추정 키) | 추정 `{monthlyFee…}` | sf | 72861 |
| 38 | GET | `/api/join/direct-contract/:contractId/:businessNumber/` | `join.getBusinessNumberVerified` | 계약 대상 확인 | – | 200/404 | sf | 72863 |
| 39 | POST | `/api/join/direct-contract/send-sms/:contractId/` | `join.postSendSmsForDirectContract` | 인증 SMS | `phone_number` | 202 | sf | 72865 |
| 40 | POST | `/api/join/direct-contract/verify-sms/:contractId/` | `join.postSmsVerified` | SMS 확인 | `phone_number, code` | 200/422 | sf | 72869 |
| 41 | POST | `/api/join/direct-contract/request-contract-form/:contractId/` | `join.postRequestContractForm` | 계약서 양식 요청 | 미확인 | 계약서 | sf | 72874 (선행 `/` 없음) |
| 42 | POST | `/api/join/direct-contract/sign-contract/:contractId/` | `join.postSubmitSignedContract` | 서명 제출 | 미확인(서명 이미지 등) | – | sf | 72879 (선행 `/` 없음) |
| 43 | POST | `/api/lead/online` | `lead.postCreateLead` | 온라인 리드 생성 | `?timestamp`; `…, lead_type:'biz', utm_*, agree_to_marketing, marketing_agreement_date` | 201 | sf | 73112 |
| 44 | PATCH | `/api/lead/online` | `lead.patchModifyLead` | 리드 보강 | `?timestamp`; 부분 필드 | 200 | sf | 73125 |

### 5.3 회사·사용자·권한

| # | 동사 | 경로 | 메서드 | 용도 | 요청 | 응답 | BE | B: |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 45 | GET | `/api/company/:cid/` | `company.getCompanyDetail` | 회사 상세 | – | `{id, sfCompanyId, kind, representativeSet[…], …}` | nexus | 66660 |
| 46 | PATCH | `/api/company/:cid/` | `company.patchCompanyDetail` | 회사 수정 | 부분 필드 | company | nexus | 66661 |
| 47 | GET | `/api/company/:cid/user/` | `companyUser.getCompanyUsers` | 사용자·초대 목록 | – | 목록(2.4) | nexus | 66631 |
| 48 | GET | `/api/company/:cid/user/:uid/` | `companyUser.getCompanyUser` | 사용자 상세 | – | 사용자 + roles | nexus | 66632 |
| 49 | GET | `/api/company/:cid/user/invitation/` | `companyUser.getCompanyUserByInvitation` | 초대 조건 조회 | params 미확인(email?) | 미확인 | nexus | 66633 |
| 50 | PUT | `/api/company/:cid/user/:uid/permissions/` | `companyUser.putCompanyUserPermissions` | 권한 부여 | 추정 `is_admin, role_ids[]` | 사용자 | nexus | 66635 |
| 51 | DELETE | `/api/company/:cid/user/:uid/` | `companyUser.deleteCompanyUser` | 사용자 제거 | – | 204 | nexus | 66637 |
| 52 | GET | `/api/company/:cid/user/:uid/permission-check/` | `companyUser.getCheckCompanyPermission` | 기능 권한 확인 | `?function, action` | 추정 `{hasPermission}` | nexus | 66627 |
| 53 | GET | `/api/company/:cid/user/me/menu-tree/:version/` | `companyUser.getMenuTree` | 내 메뉴 트리 | `?detail=true` | 노드 트리 | nexus | 66639 |
| 54 | GET | `/api/company/:cid/menu/menu-tree/:version/` | `companyUser.getCompanyAccessibleMenuTree` | 회사 기준 트리 | – | 노드 트리 | nexus | 66643 |
| 55 | GET | `/api/company/:cid/user/me/menus/` | `company.getAccessiblePermissions` | 내 접근 메뉴 | – | 추정 메뉴/권한 배열 | nexus | 66662 |
| 56 | GET | `/api/company/:cid/menus/` | `company.getCompanyMenus` | 회사 메뉴 | – | 추정 메뉴 배열 | nexus | 66664 |
| 57 | POST | `/api/company/:cid/user/me/menus/favorites/` | `company.postFavorite` | 즐겨찾기 추가 | `menu_id` | 201 | nexus | 66665 |
| 58 | DELETE | `/api/company/:cid/user/me/menus/favorites/:menuId/` | `company.deleteFavorite` | 즐겨찾기 삭제 | – | 204 | nexus | 66667 |
| 59 | GET | `/api/company/:cid/internal-invitation/` | `companyInvitation.getInternalInvitations` | 초대 목록 | – | `[invitation]` | nexus | 66677 |
| 60 | POST | `/api/company/:cid/internal-invitation/` | `companyInvitation.postCreateInternalInvitation` | 초대 생성(재초대) | 추정 `email, name?, is_admin, role_ids[]` | invitation | nexus | 66679 |
| 61 | DELETE | `/api/company/:cid/internal-invitation/:invId/` | `companyInvitation.deleteInternalInvitation` | 초대 취소 | – | 204 | nexus | 66681 |
| 62 | GET | `/api/internal-invitation/:token/` | `companyInvitation.getInternalInvitation` | 초대 조회(공개) | – | 추정 `{companyName, email, isExistingUser, status, expiresAt}` | nexus | 66683 |
| 63 | POST | `/api/internal-invitation/:token/accept/` | `companyInvitation.postAcceptInternalInvitation` | 초대 수락 | 추정 `password, confirm_password, agreements` | user/membership | nexus | 66685 |
| 64 | GET | `/api/perm/menus` | `perm.getPermMenus` | 권한 대상 메뉴 카탈로그 | – | 2/3뎁스 트리 | nexus | 72337 |
| 65 | GET | `/api/perm/roles` | `perm.getPermRoles` | 기본 권한 템플릿 | – | `[role]` | nexus | 72338 |
| 66 | GET | `/api/company/:cid/perm/role/` | `companyPerm.getCompanyPermRole` | 권한 그룹 목록 | – | `[{id, name, menus[]}]` | nexus | 72345 |
| 67 | POST | `/api/company/:cid/perm/role/` | `companyPerm.postCompanyPermRole` | 그룹 생성 | 추정 `name, menu_ids[]` | role | nexus | 72343 |
| 68 | PATCH | `/api/company/:cid/perm/role/:rid` | `companyPerm.patchCompanyPermRole` | 그룹 수정 | 부분 | role | nexus | 72346 |
| 69 | DELETE | `/api/company/:cid/perm/role/:rid` | `companyPerm.deleteCompanyPermRole` | 그룹 삭제 | – | 204 | nexus | 72348 |
| 70 | GET | `/api/company/:cid/perm/role/:rid/company-users` | `companyPerm.getCompanyPermRoleCompanyUsers` | 그룹 소속 사용자 | – | `[user]` | nexus | 72350 |
| 71 | GET | `/api/company/:cid/perm/subscription/` | `companyPerm.getCompanyPermSubscription` | 구독 | – | `[{code, isSubscribed}]` | nexus | 72352 |
| 72 | POST | `/api/company/:cid/consult/` | `consult.postConsultLead` | 회사 상담 신청 | 1.3 body | 201 | nexus | 72362 |
| 73 | GET | `/api/company/:cid/payment/` | `companyPayment.getCompanyPayments` | 결제 내역 | `?limit, offset` | DRF 봉투(2.8) | nexus | 72365 |
| 74 | GET | `/nexus-api/company/:cid/subscriptions/` | `subscription.getSubscriptions` | 구독(프록시) | – | #71과 동일 추정 | sf→nexus | 74659 |
| 75 | GET | `/api/company/:sid/` | `company.getCompany` (sf) | sf 회사 | – | `{…, agency:{type}}` | sf | 72784 |
| 76 | GET | `/api/settings/company/:sid/` | `settings.getSettingCompany` | 회사 설정 | – | 2.3 필드 | sf | 73088 |
| 77 | PATCH | `/api/settings/company/:sid/` | `settings.patchSettingCompany` | 회사·대표자 저장 | 2.3 필드 | 설정 | sf | 73090 |
| 78 | GET | `/api/settings/company/:sid/attachments/` | `settings.getSettingAttachment` | 첨부 조회 | `?name=AttachmentName` | 추정 `{name, file, url}` | sf | 73092 |
| 79 | PUT | `/api/settings/company/:sid/attachments/` | `settings.putAttachment` | 첨부 업로드 | multipart(`name`, `file`) | 첨부 | sf | 73096 |
| 80 | GET | `/api/settings/company/:sid/attachments_form/` | `settings.getAttachmentForms` | 양식 파일 | – | 양식 URL 목록 | sf | 73100 |
| 81 | GET | `/api/settings/company/:sid/contract/` | `settings.getContract` | 계약서 | `?name=ContractName` | 본문/파일 | sf | 73102 |
| 82 | GET | `/api/company/hometax/` | `companies.hometax.get` | 홈택스 수임동의 조회 | params(agreement id?) | 미확인 | sf | 72792 |
| 83 | POST | `/api/company/hometax/` | `companies.hometax.post` | 홈택스 수임동의 제출 | 미확인 | 미확인 | sf | 72787 |

### 5.4 연동·인증서·거래처 (remittance, Bearer JWT, 접두 `R` = `/api/company/:cid`)

| # | 동사 | 경로 | 메서드 | 용도 | 요청 | 응답 | B: |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 84 | GET | `R/integrations/v2/` | `getIntegrations` | 유형별 연동 상세 | `?integration_type` | 2.9 블록 | 89195 |
| 85 | GET | `R/integrations/status/` | `getScrappingStatus` | 연동·수집 상태 | `?integration_type` | 유형별 배열 | 89303 |
| 86 | GET | `R/integrations/scraping-status/` | `getCurrentScrappingStatus` | 수집 진행 폴링 | `?id` | `{status: PROGRESS|SUCCESS|FAIL}` 추정 | 89314 |
| 87 | POST | `R/integrations/request-all-scrapping/` | `postRequestAllScrapping` | 전체 수집 | – | 추정 `{id}` | 89307 |
| 88 | POST | `R/integrations/request-scrapping/:service` | `postRequestScrappingService`, `postRequestScrappingItem` | 서비스(·항목) 수집 | `corporation_number_unused`, 항목 키 | ScrapRequest | 89237, 89309 |
| 89 | GET | `R/integrations/:service/last-scrap-request-status` | `getServiceLastScrapRequestStatus` | 마지막 요청·쿨다운 | – | ScrapRequest(2.10) | 89233 |
| 90 | DELETE | `R/integrations/:integrationId/` | `deleteIntegration` | 연동 삭제(범용) | – | 204 | 89207 |
| 91 | POST | `R/integrations/hometax/` | `postIntegrateHometax` | 홈택스 연동 | 미확인(2.9) | 연동 | 89261 |
| 92 | DELETE | `R/integrations/hometax/:id/` | `deleteHometaxIntegration` | 홈택스 해제 | – | 204 | 89209 |
| 93 | POST | `R/integrations/cardsales/` | `postIntegrateCardsales` | 여신협회 연동 | `account_id, account_pw` | 연동 | 89201 |
| 94 | POST | `R/integrations/creditcard/request-card-list` | `postRequestCardList` | 카드 후보 조회 | 미확인 | 카드 후보 | 89219 |
| 95 | POST | `R/integrations/creditcard/` | `postIntegrateCreditcard` | 카드 연동 | 미확인 | 연동 | 89225 |
| 96 | GET | `R/integrations/creditcard/:id` | `getCardIntegration` | 카드사 연동 상세 | – | CardIntegration | 89211 |
| 97 | PUT | `R/integrations/creditcard/:id/:cardId` | `putCard` | 카드번호 보정 | `card_number` | card | 89213 |
| 98 | DELETE | `R/integrations/creditcard/:id/:cardId` | `deleteCard` | 카드 해제 | – | 204 | 89217 |
| 99 | POST | `R/integrations/bank/request-bank-list` | `postRequestBankAccountList` | 계좌 후보 조회 | 미확인 | 계좌 후보 | 89243 |
| 100 | POST | `R/integrations/bank/` | `postIntegrateBankAccount` | 은행 연동 | 미확인 | 연동 | 89247 |
| 101 | PATCH | `R/integrations/bank/accounts` | `patchIntegrateBankAccount` | 계좌 추가/수정 | 미확인 | – | 89249 |
| 102 | GET | `R/integrations/bank/` | `getBankIntegrationList` | 은행 연동 목록 | params 미확인 | `[BankIntegration]` | 89251 |
| 103 | GET | `R/integrations/bank/:id` | `getBankIntegration` | 은행 연동 상세 | `?is_active` | BankIntegration | 89253 |
| 104 | DELETE | `R/integrations/bank/:id/:accountId` | `deleteBankAccount` | 계좌 해제 | – | 204 | 89257 |
| 105 | POST | `R/integrations/giro/` | `postIntegrateGiro` | 인터넷지로 연동 | 미확인 | 연동 | 89259 |
| 106 | POST | `R/integrations/speedbank/` | `postIntegrateSpeedbank` | 빠른조회 등록 | 미확인 | 연동 | 89265 |
| 107 | PATCH | `R/integrations/speedbank/:id/` | `patchIntegrateSpeedbank` | 빠른조회 수정 | 미확인 | 연동 | 89269 |
| 108 | DELETE | `R/integrations/speedbank/:id/` | `deleteIntegrateSpeedbank` | 빠른조회 삭제 | – | 204 | 89273 |
| 109 | GET | `R/integrations/pg/` | `getPgScrapRequestStatusAndIntegrationStatus` | PG 목록+수집 상태 | – | `{pgs, maxRegisterPgCount, scrapRequest}` | 89235 |
| 110 | GET | `R/integrations/pg/:id/` | `getIntegrationFromPg` | PG 상세 | – | pg | 89199 |
| 111 | POST | `R/integrations/pg/` | `postIntegratePg` | PG 연동 | `pg_company, mid, …keys` 추정 | pg | 89275 |
| 112 | DELETE | `R/integrations/pg/:id/` | `deleteIntegratePg` | PG 해제 | – | 204 | 89277 |
| 113 | POST | `R/integrations/pg/scrap-request/` | `postRequestScrappingServiceFromPg` | PG 수집 | – | ScrapRequest | 89241 |
| 114 | GET | `R/integrations/delivery/` | `getDeliveryIntegrationInformation` | 배달 목록 | – | `{deliveryList, maxRegisterDeliveryCount, scrapRequest}` | 89279 |
| 115 | GET | `R/integrations/delivery/:id/` | `getIntegrateDelivery` | 배달 상세 | – | delivery | 89281 |
| 116 | POST | `R/integrations/delivery/` | `postIntegrateDelivery` | 배달 연동 | 추정 `delivery_corp, account_id, account_pw` | delivery(+stores) | 89283 |
| 117 | DELETE | `R/integrations/delivery/store/:storeId/` | `deleteDelivery` | 매장 해제 | – | 204 | 89287 |
| 118 | POST | `R/integrations/delivery/scrap-request/` | `postRequestScrappingServiceFromDelivery` | 배달 수집 | – | ScrapRequest | 89289 |
| 119 | GET | `R/cert/` | `certificate.getCertificates` | 인증서 목록 | `?detail=true` | `[Cert+status+linked]` | 89358 |
| 120 | POST | `R/cert/` | `certificate.postRegisterCert` | 인증서 등록 | 에이전트 페이로드 | Cert | 89362 |
| 121 | DELETE | `R/cert/:id` | `certificate.deleteCertificates` | 인증서 삭제 | – | 204 | 89360 |
| 122 | POST | `R/cert/:id/join/giro` | `certificate.postSignUpInternetGiro` | 인터넷지로 간편가입 | 약관 동의, giro id/pw, email, phone | – | 89364 |
| 123 | POST | `R/cert/:id/password_check` | `certificate.postCheckCertPassword` | 서명 비밀번호 확인 | `sign_pw` | 200/422 | 89366 |
| 124 | GET | `R/partner/scrap/business-status` | `partner.getBusinessStatus` | 사업자 상태 조회 | `?business_number` | 추정 `{status, taxType, closedOn}` | 89499 |
| 125 | POST | `R/partner/share-company/send` | `partner.postShareCompany` | 회사 정보 공유 발송 | 미확인 | – | 89505 |
| 126 | GET | `R/get-business_types` | `company.getBusinessTypes` | 업종 코드 조회 | – | 추정 업종 목록 | 89487 |
| 127 | POST | `R/update-business_types` | `company.postUpdateBusinessTypes` | 업종 갱신(홈택스 스크랩) | – | – | 89485 |
| 128 | GET | `/api/company/:cid` (remittance) | `company.getCompany` | remittance 회사 | – | 미확인 | 89489 |

**합계 128개** (5.1: 28, 5.2: 16, 5.3: 39, 5.4: 45). 범위 내 엔드포인트 중 번들에 호출부가 없는 것: AI 비서, 지원금 추천, 쿼타북 연동 키(모두 lazy chunk).

---

## 6. 외부 연동 경계 (어댑터로 분리할 것)

| 어댑터 | 책임 | 현행 근거 | 비고 |
| --- | --- | --- | --- |
| `ScrapingGateway` (유형별 드라이버) | 홈택스(ID/인증서), 여신협회, 카드사 20종, 은행 30여 종(인증서/ID/빠른조회), 인터넷지로, 배달 3사, 올라 | 120s 동기 타임아웃 엔드포인트 다수 | 후보 조회(`request-*-list`)는 **동기**, 정기·수동 수집은 **비동기 큐**(ScrapRequest). 상용 스크래핑 벤더(쿠콘/코드에프 류) 교체 가능하게 인터페이스 고정: `listCandidates`, `verifyCredential`, `scrape(item, range)`, 결과 코드→`is_retryable` 매핑 |
| `PgReconciliationClient` | PG 9사 승인/정산 대사 | MID+키, IP 화이트리스트 | 고정 egress IP 필수 |
| `CertificateAgent` 프로토콜 | 로컬 ExAdapter가 만든 인증서 페이로드 수신·보관·서명 | Windows 전용 프로그램 | 서버는 포맷만 맞추고, 서명 연산은 수집 워커(HSM/격리) 안에서 |
| `HometaxDelegationClient` | 세무대리인 수임동의(`/hometax/agreement/:id`) | sf `/api/company/hometax/` | 세무 기장 전환 필수 단계 |
| `BusinessStatusClient` | 국세청 사업자 상태 조회 | `partner/scrap/business-status`, pre-signup 사업자번호 확인 | 공공데이터 API 대체 가능 |
| `MailSender` | 가입 인증, 비밀번호 재설정, 사용자 초대, 가입 초대 | | 템플릿·링크 만료 |
| `SmsSender` / `AlimtalkSender` | 직접 계약 SMS 인증, 결제 D-1 알림톡, 상담 접수 알림톡 | | 발신번호·템플릿 승인 |
| `CmsBillingClient` | CMS 출금 동의 등록, 출금 요청, 결과 파일(익일) 수신, 재시도 | 결제 상태 5종 | 비영업일 처리 |
| `KakaoOAuth` | `/api/login/social/` code 교환 | `provider` 파라미터 | 이후 provider 추가 대비 |
| `PartnerAuth` | 오버택스 SSO 토큰, `/api/external/*` payload JWT·API key | | 파트너별 키 관리 |
| `AddressSearch` | 우편번호·주소 | 회사 관리 주소검색 | 클라이언트 측일 가능성 높음 |
| `LlmAgent` | AI 비서(RAG + 도구 호출: 거래/계좌 조회, 세금계산서 발행, 증명서 요청, 직원·급여 조회) | `/ai-agent` | 도구 권한 = `decide()` + 구독. 쓰기 도구는 확인 후 실행 |
| `GrantFeed` | 정부·지자체 지원금 공고 수집(매일 04:00), 업종·지역 매칭 | `/recommend/grant` | 기업마당 등 공공 API |
| `ChatChannelBridge` | 슬랙·카카오톡 상담 채널 ↔ 회사 연결 | `chat-channel` | 토큰 발급은 채널 쪽 |
| `ExternalServices` | 시프티(급여 노트), 쿼타북(데이터 제공, 연동 키) | `/integrate/external/*` | 쿼타북 푸시 주기·범위 미확인 |
| `FileStorage` | 사업자등록증·동의서·이전 세무자료·계약서 | 경로 `company/{id}/{name}_{hash}.{ext}` | tax-api `lib/file-storage` 재사용 |

---

## 7. 미확인 사항

1. 로그인·가입 계열 **요청 body 전체**(`signup/user/email`, `signup/company`, `internal-invitation` POST/accept, `join/*`, `withdrawal-consent`) — lazy chunk(`SignUp`, `RegisterCompany`, `InternalJoin`, `Join`, `ContractOfBookkeeping`)를 받아야 확정.
2. `isSystemAdmin`과 회사 관리자(`role='admin'`)의 관계, 회사당 개수, 이전 방법.
3. `GET /api/company/:cid/user/me/menus/`(accessiblePermissions)와 `/menus/`, `/perm/menus`의 응답 차이. 권한 그룹이 메뉴 **id**인지 **code**인지(즐겨찾기는 `menuId`).
4. `permission-check`의 `function`/`action` 값 목록 — 메뉴 외 기능 권한 축이 따로 있는지.
5. 연동 등록 요청 키(hometax/creditcard/bank/giro/speedbank/pg/delivery) — 화면 chunk `Integrate-Transaction`, `Integrate-Tax`, `ManageCert` 필요. 세무신고 기관 연동의 홈택스 ID/PW가 내역 수집 홈택스 `accountInfo`와 같은 레코드인지.
6. `allra` 연동 API(번들에 등록 엔드포인트 없음)와 콜백 방식.
7. `corporationNumberUnused`의 의미(홈택스 법인번호 미사용 조회 추정).
8. 인증서 등록 페이로드 포맷, 서명 비밀번호를 서버가 보관하는지(정기 수집에는 필요해 보임) 여부.
9. `/api/company/hometax/`(sf) GET/POST의 의미 — 수임동의(`/hometax/agreement/:agreementId`)와 연결 추정.
10. 구독 응답의 추가 필드(`name`, `startedAt`, 플랜 상세), `free` 코드 존재 여부, `taxPlan` 값 종류(`taxation` 외).
11. 결제 내역 응답 키, 결제 상태 원문 값.
12. 데모 로그인 흐름(`/api/member/demo/` 응답과 이후 로그인 방식), 데모 계정 공유 여부.
13. 쿼타북 연동 키 등록 API, 제공 데이터 범위·주기. `/api/external/*`의 실제 파트너(쿼타북/오버택스/기타).
14. 초대 만료를 서버가 상태로 저장하는지(배치) 조회 시 파생하는지. 재초대가 새 행인지.
15. AI 비서 API(대화 저장·스트리밍 방식), 지원금 추천 API·데이터 원천.
16. `share-company/send`의 수신 채널(이메일/SMS/카카오)과 body.
17. 세션 만료 기간, `staySignedIn` 효과, 로그인 실패 잠금 정책(번들에 단서 없음).
18. `company_id`가 remittance 경로에서 nexus id인지 sf id인지 — 엔트리 번들만으로는 호출 인자를 못 봄(JWT는 nexus id 기준 발급).
