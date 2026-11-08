# Identity & Access 규칙 결정

인증·회사·권한 규칙 6개의 열린 질문 32개에 대한 서버 결정입니다. 설계는 [identity-access.md](../identity-access.md)에 있습니다. 읽는 법은 [README](README.md)를 따릅니다.

> **상태: 결정됨 (가정 포함, 2026-11-07).** 권장안을 결정으로 채택했습니다. 보류 4건은 2026-11-07에 정했습니다. 내부 자료가 필요한 3건은 **가정**(학습용 가정, [읽는 법](README.md#읽는-법))이고, 가입 때 상태조회는 레거시를 따르기로 했습니다(2026-11-08 구현).

## 요약

| 영역 | 규칙 | 질문 | 따름 | 바꿈 | 가정 |
|---|---|---:|---:|---:|---:|
| 약관 | [terms-reagreement](#terms-reagreement) | 6 | 1 | 4 | 1 |
| 진입 | [entry-guard-order](#entry-guard-order) | 5 | 1 | 4 | 0 |
| 권한 | [menu-visibility](#menu-visibility) | 6 | 3 | 2 | 1 |
| 계정 | [password-policy](#password-policy) | 5 | 3 | 1 | 1 |
| 구성원 | [internal-invitation](#internal-invitation) | 6 | 5 | 1 | 0 |
| 회사 | [business-number-checksum](#business-number-checksum) | 4 | 3 | 1 | 0 |
| | **합계** | **32** | **16** | **13** | **3** |

## 약관

### terms-reagreement

[규칙 문서](../../reference/rules/terms-reagreement.md) · 케이스 20 · 질문 6

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | 응답 기록이 없는 필수 약관(`history: null`) | **따름:** 현행 서버처럼 동의 필요(`REQUIRED`)로 봅니다. 클라이언트의 TypeError는 재현하지 않습니다 | 신규 사용자가 진입하지 못하는 버그입니다 |
| 2 | 선택 약관 새 버전마다 재동의 화면으로 보낼까요 | **바꿈:** 선택 약관은 `REVIEW`로 안내만 하고 막지 않습니다. 지금 버전에 응답(동의·거절)하면 `SETTLED` | 마케팅 동의 거절자를 매번 막을 이유가 없습니다 ([약관](../identity-access.md#약관)) |
| 3 | 버전을 타입 섞어 엄격 비교 | **바꿈:** 버전은 문자열 하나로 저장·비교합니다 | 표기 차이로 재동의가 생기지 않게 합니다 |
| 4 | 세무 약관 용도를 "소속 회사 중 하나라도"로 판정 | **바꿈:** 토큰이 묶인 지금 회사가 `TAXATION`일 때만 `TAX`를 적용합니다 | 토큰 하나 = 회사 하나라서 무료 회사에서 막힐 이유가 없습니다 |
| 5 | 서버가 클라이언트 가드에 기댐 | **바꿈:** `authorize({ requiresTerms: true })`로 제품 API를 403 `TERMS_REAGREEMENT_REQUIRED`로 막습니다. 세무 대리인은 건너뜁니다 | 우회 경로를 없앱니다 |
| 6 | 세무 기장 전용 약관 목록 | **가정:** 데모 시드의 `TAX_SERVICE` 하나로 둡니다 | 학습용 가정. 실제 약관 카탈로그와 코드는 내부 자료라 이 저장소에서 받을 수 없습니다. 약관이 하나여도 재동의 판정(버전·용도)은 같은 규칙으로 돕니다 |

**바뀌는 케이스:** `version compared with strict inequality across types` → `false`. `purposes when any company is taxation`, `guard *`, `legacy server refuses *`는 서버 함수로 옮기지 않고 HTTP 테스트(`terms.http.test.ts`)가 422 `REQUIRED_TERM_DECLINED`·409 `TERM_VERSION_OUTDATED`로 확인합니다.

## 진입

### entry-guard-order

[규칙 문서](../../reference/rules/entry-guard-order.md) · 케이스 19 · 질문 5

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | 접근할 수 없는 회사 ID를 요청하면 | **바꿈:** 다음 후보로 넘어가지 않고 404 `COMPANY_NOT_FOUND`입니다 | 사용자가 고른 회사와 다른 회사의 데이터를 보여 주지 않습니다 |
| 2 | nexus·sf 이메일 비교의 대소문자 | **바꿈:** 프로필이 하나라 비교가 사라집니다. 이메일은 소문자로 정규화합니다 | 두 백엔드를 합쳤습니다 |
| 3 | 기본 회사가 목록의 마지막 | **바꿈:** 마지막으로 쓴 회사, 없으면 가장 먼저 소속된 회사입니다 | API 순서에 기대지 않습니다 |
| 4 | 세무 동의 단계가 "세무 회사 하나라도" | **바꿈:** 지금 회사 기준입니다(terms-reagreement 4와 같음) | 같은 결정입니다 |
| 5 | 회사 없는 사용자의 약관 가드 | **따름:** 가입·초대 수락이 `SIGNUP` 필수 약관을 받으므로 회사 없는 사용자도 가입 약관을 거친 상태입니다. `TAX`는 회사가 없어 적용되지 않습니다 | 현행 순서와 같은 결과입니다 |

**바뀌는 케이스:** `company from the sf id query wins over everything` → `{ companyId: 12 }`(쿼리 정리는 사라짐), `last company when nothing else is set` → `11`, `query id the user does not belong to falls through` → `NOT_FOUND`. `guard *`, `initialize *`는 사라지는 화면 흐름이라 옮기지 않습니다.

## 권한

### menu-visibility

[규칙 문서](../../reference/rules/menu-visibility.md) · 케이스 20 · 질문 6

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | 프로모션 외 메뉴 코드가 번들에 없음 | **가정:** [메뉴 코드 → 권한 표](../identity-access.md#현행-메뉴-코드--권한)를 현행 서버 제안 코드로 둡니다 | 학습용 가정. 실제 메뉴 코드 목록은 내부 자료라 받을 수 없습니다. 서버 판정은 권한 문자열로 하고 메뉴 코드는 표 하나에만 있어, 코드가 달라도 표만 고치면 됩니다 |
| 2 | 메뉴는 권한 → 플랜 순서라 권한 없는 구성원은 프로모션을 못 봄 | **따름:** 화면은 권한 → 플랜 순서로 그립니다. API의 `authorize`는 플랜 → 권한 순서라 권한 있는 사용자에게 업셀 403을 줍니다 | 권한 없는 구성원에게 업셀은 의미가 없습니다 |
| 3 | AI 비서가 시스템 관리자 전용 | **바꿈:** 매뉴얼대로 모두에게 엽니다(`conversation:*`가 기본 권한) | 매뉴얼이 최신 의도입니다 ([assistant.md](../assistant.md)) |
| 4 | 두 플랜 회사의 `payroll_management` | **따름:** `PAYROLL`이 있으면 보입니다 | 현행과 같습니다 |
| 5 | 권한 그룹이 메뉴 ID를 저장 | **바꿈:** 권한 문자열을 저장합니다. 이관은 메뉴 코드로 바꿉니다(`permissionsForLegacyMenus`) | 메뉴 개편이 권한 데이터를 깨지 않게 합니다 |
| 6 | `pb_*` 프로모션의 플랜 | **따름:** 둘 다 `PAYROLL` 프로모션입니다(`promotedPlans`) | 현행 클라이언트 규칙과 같습니다 |

**바뀌는 케이스:** `ai_agent hidden from an admin who is not the system admin` → `visible`. 사업자 형태별 신고 메뉴, 급여 구독 시 `employee_management` 숨김, 빈 그룹 정리는 화면 트리 규칙이라 옮기지 않습니다.

**대리인 메뉴(D5, 2026-11-06):** `assigned agency staff see every applicable menu without the terms gate`는 사업자 형태 규칙(`tax_aggr_income`) 때문에 옮기지 않은 케이스이고, 테스트는 대리인 권한을 `*`가 아니라 실제 대리인 기본 권한(`actorPermissions({ kind: 'AGENCY' })`)으로 만듭니다. 이 케이스의 `user_management`는 현행 `visible`에서 서버 기준 `hidden`(`PERMISSION_DENIED`)으로 바뀝니다. 대리인 기본 권한에 `member:*`가 없기 때문입니다([review.md](../review.md#결정) D5). `tax_surtax`·`tax_corporation`은 그대로 보입니다. 고객 사용자의 케이스는 바뀌지 않습니다.

## 계정

### password-policy

[규칙 문서](../../reference/rules/password-policy.md) · 케이스 19 · 질문 5

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | 영문·숫자 판정과 특수문자 | **따름:** 영문은 ASCII, 숫자 하나 이상, 특수문자 허용, 8–20자 | 현행 픽스처와 같습니다 |
| 2 | 공백 | **따름(현행 서버):** 공백을 거절합니다(`PASSWORD_WHITESPACE`) | 클라이언트만 통과시키던 불일치를 서버 기준으로 맞춥니다 |
| 3 | 재설정 토큰 수명·1회용 | **가정:** 30분·1회용으로 정합니다. 재설정은 아직 구현하지 않았습니다 | 학습용 가정. 현행 내부 서비스 설정은 받을 수 없어 더 안전한 쪽(짧은 수명, 한 번 쓰면 폐기)을 고릅니다 |
| 4 | 비밀번호 변경 후 세션 | **따름:** 그 사용자의 모든 세션을 폐기합니다 | 클라이언트가 `/login`으로 보내는 현행 동작과 같습니다 |
| 5 | 이전 비밀번호 재사용, 로그인 잠금 | **바꿈:** 연속 5회 실패하면 잠급니다(423 `ACCOUNT_LOCKED`). 재사용은 막지 않습니다 | 무차별 대입을 막습니다. 잠금 해제 방식은 [열린 질문](../identity-access.md#열린-질문) 1 |

**바뀌는 케이스:** 없음. `confirmation mismatch`(화면 검증), 변경·재설정 케이스는 옮기지 않습니다.

## 구성원

### internal-invitation

[규칙 문서](../../reference/rules/internal-invitation.md) · 케이스 20 · 질문 6

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | 만료를 저장할까, 읽을 때 파생할까. 다시 초대가 행을 재사용할까 | **따름:** 만료는 `expiresAt`으로 파생하고, 다시 초대는 새 초대를 만듭니다 | 배치 없이 정확합니다 |
| 2 | 대기 중 문구(`가입 대기중` / `유효기간 N일 남음`) | **따름:** 서버는 `status`와 `remainingDays`를 주고 문구는 화면이 정합니다 | 두 문구 모두 그릴 수 있습니다 |
| 3 | 남은 일수 반올림 | **따름:** 만료 시각까지 올림입니다 | 현행 서버와 같습니다 |
| 4 | 계정이 있는 초대 대상이 로그인하지 않고 수락 | **바꿈:** 로그인한 상태이거나 수락 요청에 비밀번호를 보내면 됩니다. 다른 계정으로 로그인했으면 403 | 메일 링크에서 한 번에 끝냅니다. 비밀번호로 본인을 확인하므로 안전성은 같습니다 |
| 5 | `user_management` 메뉴를 가진 일반 사용자의 초대 취소 | **따름:** 관리자 전용(`invitation:cancel`)입니다 | 매뉴얼 "일반 사용자는 초대 불가"와 같은 축입니다 |
| 6 | 초대 후 지운 권한 그룹 | **따름:** 수락할 때 남아 있는 그룹만 붙입니다 | 그룹 삭제가 초대를 실패시킬 이유가 없습니다 |

**바뀌는 케이스:** 닫힌 초대 취소 두 건 → 410 `INVITATION_CLOSED`(`reason` 포함, 수락과 같은 오류), `invitation list leaves out cancelled and accepted rows` → 모든 초대를 상태와 함께 돌려줍니다. 수락 케이스는 `invitations.http.test.ts`가 확인합니다.

## 회사

### business-number-checksum

[규칙 문서](../../reference/rules/business-number-checksum.md) · 케이스 16 · 질문 4

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | 클라이언트 검증과 같은 알고리즘인가 | **따름:** 현행 서버의 가중치(1,3,7,1,3,7,1,3,5 + ⌊9번째×5/10⌋)를 씁니다 | 국세청 공개 규칙과 같습니다 |
| 2 | 모두 0 같은 퇴화 번호 | **따름:** 검증 숫자만 봅니다. 실재 여부는 보지 않습니다. 사업자 상태조회는 폐업만 막고 미등록(없는 번호)은 등록합니다(결정 3) | 형식 검사와 실재 검사를 나눕니다 |
| 3 | 가입 때 국세청 상태조회를 부를까 | **따름:** 회사 등록 전에 사업자 상태조회를 부르고 폐업이면 막습니다. 휴업·조회 실패·알 수 없음은 등록을 허용합니다. 막을 때는 422 `BUSINESS_CLOSED`입니다(2026-11-08 구현, [열린 질문 10](../identity-access.md#열린-질문)) | 설계 결정(2026-11-07). 재설계 전 구현은 등록 때 `businessStatus.lookup`을 부르고 `closed`만 막았습니다(`apps/api/legacy/src/modules/platform/accounts/accounts.service.ts` `registerCompanyForUser`). 외부 API 장애가 가입을 막지 않게 실패는 허용합니다. Identity & Access `BusinessStatusCheck` 포트를 `wiring/identity-access-integrations.ts`가 Integrations `BusinessStatusClient`로 구현합니다 |
| 4 | 법인등록번호 검증 공식(가중치 1,2) | **바꿈:** 검증 숫자를 보지 않고 13자리 숫자인지만 봅니다 | 2025-01-31부터 부여하는 법인등록번호는 등기관서 4 + 법인종류 2 + 일련번호 7자리이고 오류검색번호가 없습니다(제2조 ⑤ 삭제). 그 전 번호만 마지막 자리가 오류검색번호라 번호만으로 형식을 가를 수 없습니다([법인 및 재외국민의 부동산등기용등록번호 부여에 관한 규칙 제2조 ①, 대법원규칙 제3173호 부칙](https://www.law.go.kr/법령/법인및재외국민의부동산등기용등록번호부여에관한규칙)) |

**바뀌는 케이스:** `corporate number with a wrong check digit` → 통과(질문 4).

## 결정 기록

### 토큰 하나 = 회사 하나

- **결정:** access token은 회사 하나에 묶이고 경로에 회사 ID를 넣지 않습니다. 약관 용도·기본 회사·플랜 판정을 모두 지금 회사 기준으로 바꿉니다(terms-reagreement 4, entry-guard-order 1·3·4)
- **검토한 대안:** 사용자 토큰 + 경로의 회사 ID(현행 nexus 방식), 토큰에 회사 목록 전체를 담기
- **선택 이유:** 다른 회사 ID를 넣는 실수를 서버가 구조적으로 막고, 권한 계산을 토큰 발급 때 한 번만 합니다
- **가정과 되돌릴 조건:** 여러 회사를 한 화면에서 보는 기능(세무 대리인 데스크)이 고객 API로 들어오면 대리인 전용 API를 따로 둡니다

### 권한 그룹 = 권한 문자열 프리셋

- **결정:** 그룹은 `resource:action` 목록을 저장하고, 관리자 전용 동작은 넣을 수 없습니다(menu-visibility 5, internal-invitation 5)
- **검토한 대안:** 현행처럼 메뉴 ID 저장, 역할 고정(경리·인사…)만 허용
- **선택 이유:** 메뉴 개편과 권한 데이터를 떼고, "일반 사용자는 초대·권한 관리 불가"를 데이터로 표현합니다
- **가정과 되돌릴 조건:** 회사가 관리자 전용 동작을 일부 위임하길 원하면 `adminOnly`를 회사 설정으로 풉니다

### 선택 약관은 막지 않음

- **결정:** 선택 약관 새 버전은 `REVIEW`로 안내만 합니다(terms-reagreement 2)
- **검토한 대안:** 현행처럼 매 버전 재동의 화면으로 보내기
- **선택 이유:** 거절한 사람을 반복해서 막는 것은 동의 강요에 가깝습니다
- **가정과 되돌릴 조건:** 법무가 선택 약관 개정에도 재확인을 요구하면 `REVIEW`를 화면 강제로 바꿉니다(서버 게이트는 그대로)

### 로그인 잠금

- **결정:** 연속 5회 실패하면 잠그고, 모르는 이메일과 틀린 비밀번호를 같은 401로 답합니다(password-policy 5)
- **검토한 대안:** 잠금 없음(현행 추정), CAPTCHA, 시간 기반 지연
- **선택 이유:** 메모리 구현으로도 바로 강제할 수 있고 감사 로그와 맞물립니다
- **가정과 되돌릴 조건:** 잠금이 서비스 거부로 악용되면 시간 기반 자동 해제로 바꿉니다
