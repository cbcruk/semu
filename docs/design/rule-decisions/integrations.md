# Integrations 규칙 결정

기관 연동·인증서·수집·상담 채널 규칙 5개의 열린 질문 28개에 대한 서버 결정입니다. 설계는 [integrations.md](../integrations.md)에 있습니다. 읽는 법은 [README](README.md)를 따릅니다.

> **상태: 결정됨 (가정 포함, 2026-11-05).** 권장안을 결정으로 채택했습니다. **보류**는 외부 사실(수집 업체 동작, 기관 코드표, 메신저 브리지) 확인 전까지 현행 동작을 임시 결정으로 둡니다.

## 요약

| 영역 | 규칙 | 질문 | 따름 | 바꿈 | 보류 |
|---|---|---:|---:|---:|---:|
| 수집 | [scrap-cooldown](#scrap-cooldown) | 6 | 1 | 3 | 2 |
| 수집 | [scrap-retryable](#scrap-retryable) | 5 | 1 | 3 | 1 |
| 인증서 | [certificate-eligibility](#certificate-eligibility) | 6 | 4 | 0 | 2 |
| 연동 | [integration-registration-limits](#integration-registration-limits) | 6 | 2 | 3 | 1 |
| 상담 채널 | [chat-channel-token](#chat-channel-token) | 5 | 2 | 2 | 1 |
| | **합계** | **28** | **10** | **11** | **7** |

## 수집

### scrap-cooldown

[규칙 문서](../../reference/rules/scrap-cooldown.md) · 케이스 17 · 질문 6

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | 600초 쿨다운·타임아웃은 레거시 서버가 정한 값 | **보류:** 600초를 기관 종류별 정책 표(`SCRAP_COOLDOWN_SECONDS`)에 두고 값은 그대로 씁니다 | 수집 업체의 호출 한도를 확인해야 값을 정할 수 있습니다 |
| 2 | 쿨다운 단위(서비스/연동/항목) | **따름:** 기관 종류(`institutionType`) 단위입니다. `integrationId`·`itemKey`로 범위를 좁혀도 같은 종류의 쿨다운을 씁니다 | 수집 업체 호출이 기관 로그인 단위라 항목별로 풀면 같은 계정에 연속 로그인합니다 |
| 3 | 진행 중인 시스템 수집이 버튼을 막는데 `remainSeconds`는 0 | **바꿈:** 진행 중이면 `reason: RUNNING`과 타임아웃까지 남은 초를 `retryAfterSeconds`로 줍니다. 429도 같은 값입니다 | 화면이 "수집 중"과 남은 시간을 함께 그릴 수 있습니다 |
| 4 | 일부 항목만 실패해도 묶음 전체가 `FAIL` | **바꿈:** `PARTIALLY_SUCCEEDED`이고 항목별 결과를 `result.items`에 줍니다 | [conventions.md](../conventions.md#비동기-작업)의 `Job` 상태를 따릅니다 |
| 5 | 정기 수집 주기가 서버에 없음 | **바꿈:** 스케줄러가 기관별 주기 정책으로 `requester: SYSTEM` 요청을 만듭니다(구현 전) | 매뉴얼의 주기(은행 1일, PG 10·22시, 배달 10시 5일치, 올라 06시, 지원금 04시)를 서버가 책임집니다 |
| 6 | `corporationNumberUnused`가 무엇을 바꾸는지 | **보류:** `options`로 받아 어댑터에 그대로 넘깁니다 | 홈택스 조회 옵션으로 추정만 됩니다 |

**바뀌는 케이스:**
- `system request still running blocks the button but reports 0 seconds`: `remainSeconds: 0` → `reason: RUNNING`, `retryAfterSeconds: 540`
- `manual request while a system request runs is refused with remain at least 1`: `remain_seconds: 1` → 429 `SCRAP_REQUEST_TOO_SOON`(`RUNNING`, 540)
- `polling: one failed item makes the whole group FAIL`, `polling: a timed out request is FAIL`: `FAIL` → `PARTIALLY_SUCCEEDED`
- `manual request without any connected integration is a validation error`: 400 `VALIDATION_FAILED` → 422 `INSTITUTION_NOT_CONNECTED`
- 쿨다운 429는 `RATE_LIMITED`/`remain_seconds` → `SCRAP_REQUEST_TOO_SOON`/`retryAfterSeconds`

### scrap-retryable

[규칙 문서](../../reference/rules/scrap-retryable.md) · 케이스 18 · 질문 5

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | `UNREGISTERED` 인증서를 클라이언트는 막지 않고 레거시 서버는 막음 | **바꿈:** 인증서 연동은 인증서가 `ACTIVE`일 때만 재시도할 수 있습니다. `UNREGISTERED`·`EXPIRED`·`INACTIVE`면 `RETRY`와 `SCRAP`을 빼고 `status: ERROR`입니다 | 인증서가 없으면 수집이 반드시 실패합니다 |
| 2 | PG·올라는 결과가 없으면 재시도 없음, 카드매출·배달은 있음 | **바꿈:** 기관 종류와 관계없이 결과가 없으면 참입니다. 다만 버튼은 `RETRY`가 아니라 `SCRAP`입니다(`RETRY`는 마지막 수집이 실패했을 때만) | 수집한 적 없는 연동은 재시도가 아니라 첫 수집 대상입니다 |
| 3 | 카드사·빠른조회 판정식이 번들에 없음 | **따름:** 은행 규칙(인증서 게이트 + 항목별)을 모든 종류에 같은 식으로 씁니다 | 식이 하나라 종류가 늘어도 따로 정할 것이 없습니다 |
| 4 | 어떤 수집 오류가 재시도 불가인지 | **보류:** 어댑터가 오류 코드를 분류해 `isRetryable`을 정합니다. 가짜 어댑터는 `INVALID_CREDENTIAL`만 거짓입니다 | 수집 업체 오류 코드표가 필요합니다 |
| 5 | 홈택스 ID + 인증서일 때 ID 쪽만 봄 | **바꿈:** 두 연동이 각자 `allowedActions`를 가집니다 | 인증서 쪽 오류가 화면에서 사라지지 않습니다 |

**바뀌는 케이스:**
- `client hometax: certificate only, UNREGISTERED is not checked -> lastScrapping decides`: 참 → 거짓
- `client hometax: ID and certificate both, ID side decides even when the certificate expired`: 참 하나 → 연동별 `[참, 거짓]`
- `client pg: value as-is, missing lastScrapping is falsy`: 거짓 → 참(버튼은 `SCRAP`)

## 인증서

### certificate-eligibility

[규칙 문서](../../reference/rules/certificate-eligibility.md) · 케이스 20 · 질문 6

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | OID 표가 번들 표의 일부 | **보류:** 레거시 표를 그대로 씁니다. 모르는 OID는 422 `CERTIFICATE_NOT_ACCEPTED`(`OID_UNKNOWN`) | 번들 표 전체(KICA·tradesign)를 옮겨 참조데이터로 둬야 합니다 |
| 2 | 법인 전자세금용 인증서 등록 시 용도 검사 | **따름:** 등록은 받고, `usableFor`가 홈택스만 보여 줍니다 | 매뉴얼이 등록을 허용합니다. 쓸 수 없는 곳은 연동 단계에서 422 `CERTIFICATE_NOT_USABLE`로 막습니다 |
| 3 | 개인 인증서 명의를 대표자 이름 문자열로 비교 | **따름:** 등록된 대표자 이름과 정확히 같아야 합니다 | 동명이인·개명은 회사 대표자 정보를 고쳐 해결합니다 |
| 4 | `INACTIVE` 감지 시점 | **보류:** 저장 상태로 두고 지금은 아무도 바꾸지 않습니다. 수집 어댑터 오류 코드로 갱신할 예정입니다 | 발급기관 폐기 확인 API 유무를 확인해야 합니다 |
| 5 | 지로 계정에 인증서가 등록돼 있어야 하는 조건 | **따름:** 미리 검사하지 않고 `:join-giro`와 연동 시도 결과로 알립니다 | 서버가 사전에 확인할 방법이 없습니다 |
| 6 | 다른 회사 지로 계정에 묶인 인증서를 미리 막을지 | **따름:** 막지 않습니다. 시도 결과(`INSTITUTION_CREDENTIAL_REJECTED`)로 알립니다 | 같은 이유입니다 |

**바뀌는 케이스:** 판정 결과는 모두 같습니다. 거절 응답이 400(`field: owner_name`) → 422 `CERTIFICATE_NOT_ACCEPTED`(`reason`, `field: ownerName`)로 바뀌고, `CERT_NOT_ALLOWED_FOR_SERVICE`는 `CERTIFICATE_NOT_USABLE`(`NOT_ALLOWED_FOR_INSTITUTION`)입니다. `classify` 케이스의 표시 문구(`개인(은행/카드/보험용)`, `금융결제원`)는 클라이언트 사전이 `ownerType`·`usage`·`issuerCode`로 그립니다.

## 연동

### integration-registration-limits

[규칙 문서](../../reference/rules/integration-registration-limits.md) · 케이스 20 · 질문 6

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | 한도 20을 세는 단위와 비활성 항목 | **바꿈:** 카드·계좌·매장은 활성 항목 수, PG는 연동 수로 셉니다. 비활성 항목은 세지 않습니다. 목록 응답의 `limits`가 `unit`과 쓴 수를 줍니다 | 끈 계좌가 한도를 차지하면 새 계좌를 못 붙입니다 |
| 2 | 하나·롯데·삼성 법인카드 ID/PW 전용, 신한 빠른조회 전용 | **바꿈:** 기관별 허용 인증 방법을 서버가 검사합니다(422 `AUTH_METHOD_NOT_SUPPORTED`). 신한은행 인터넷뱅킹 ID 거절은 은행 코드표를 받은 뒤 넣습니다 | 매뉴얼에만 있던 제약을 서버 규칙으로 옮깁니다 |
| 3 | `CF_` 제한이 토스페이·유플러스에도 해당하는지 | **따름:** `TOSSPAYMENTS`만 막습니다 | 근거가 카페24 발급 토스페이먼츠 MID뿐입니다 |
| 4 | 세무신고용 홈택스 ID와 내역 수집용 홈택스 ID가 같은 레코드인지 | **보류:** 같은 레코드 하나로 두고 `usableForTaxFiling`으로 세무사 프로그램 전달 여부를 표시합니다 | 세무사 프로그램 연동 방식을 확인해야 합니다 |
| 5 | 이니시스·나이스 IP 화이트리스트를 검증할 수 없음 | **따름:** 등록 응답의 `ipWhitelist`로 안내만 하고, 첫 대사 실패를 수집 결과로 알립니다 | 사전 검증 수단이 없습니다 |
| 6 | 등록을 비동기 작업으로 바꿀지 | **바꿈:** 후보 조회·자격 확인만 동기로 두고, 첫 수집은 `POST /scrap-requests`(Job)로 분리합니다 | 120초 동기 호출을 없앱니다 |

**바뀌는 케이스:**
- 한도 초과·인증 방법·PG 키 오류: 400 `VALIDATION_FAILED`(snake_case `field`) → 422 `INTEGRATION_LIMIT_EXCEEDED`/`AUTH_METHOD_NOT_SUPPORTED`/`PG_KEYS_INVALID`(camelCase `field`: `itemKeys`, `mid`, `keys.clientSecret`, `certificateId`)
- `creditcard: selecting only already registered cards is refused`: 400 `cards` → 409 `INTEGRATION_DUPLICATE`(`NO_NEW_ITEMS`), 배달과 같게
- `creditcard: ID login with two card companies at once is refused`: 400 `card_codes` → 400 `VALIDATION_FAILED`(`institutionCodes`, `INVALID_VALUE`)
- `creditcard: corporate 하나·롯데·삼성 cards only via ID/PW`: 매뉴얼만 → 422 `AUTH_METHOD_NOT_SUPPORTED`
- 중복 409 `CONFLICT` → 409 `INTEGRATION_DUPLICATE`(`SAME_INTEGRATION`)

## 상담 채널

### chat-channel-token

[규칙 문서](../../reference/rules/chat-channel-token.md) · 케이스 11 · 질문 5

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | 토큰 수명 | **보류:** 메신저 브리지가 발급할 때 정한 `expiresAt`을 그대로 씁니다 | 브리지 설정을 확인해야 합니다 |
| 2 | 본문의 sf `company_id` | **바꿈:** 회사는 로그인한 회사(토큰)입니다. 다른 회사로 연결하려면 회사를 전환합니다 | 회사 ID가 하나가 되고 경로·본문에 회사 ID를 넣지 않습니다 |
| 3 | 영어 문장을 클라이언트가 문자열 비교 | **바꿈:** `CHAT_CHANNEL_TOKEN_INVALID`·`USED`·`EXPIRED` 코드로 구분합니다 | [conventions.md](../conventions.md#오류) |
| 4 | 회사당 채널 여러 개, 다른 회사로 재연결 | **따름:** 회사는 채널을 여럿 가질 수 있고, 토큰은 한 번만 씁니다. 다른 회사로 옮기려면 브리지가 새 토큰을 발급합니다 | 토큰 사용 기록이 연결 이력이 됩니다 |
| 5 | 연결에 관리자 권한이 필요한지 | **따름:** 구성원 기본 권한 `messenger-channel:link`로 충분합니다 | 현행도 소속만 확인합니다 |

**바뀌는 케이스:**
- 실패 응답 `{failReason: 'token is …'}` → 422 `CHAT_CHANNEL_TOKEN_*`
- `connect to a company the user does not belong to is refused and leaves the token unused`: 요청이 생기지 않습니다(회사는 로그인한 회사)
- 링크 쿼리 해석 2건은 클라이언트 라우팅이라 서버 테스트로 옮기지 않습니다

## 결정 기록

### 수집 요청은 `Job` 하나

- **결정:** 수집 요청 상태를 `QUEUED|RUNNING|SUCCEEDED|PARTIALLY_SUCCEEDED|FAILED`로 합치고, 타임아웃은 읽을 때 `FAILED`(`SCRAP_TIMEOUT`)로 파생합니다(scrap-cooldown 3·4)
- **검토한 대안:** 현행처럼 요청 상태와 폴링 상태를 따로 두기, 묶음(request-all) 하나를 `Job` 하나로
- **선택 이유:** 쿨다운은 기관 종류별 마지막 요청으로 판정하므로 기관 종류마다 요청이 따로 있어야 합니다. 일부 실패를 숨기지 않습니다
- **가정과 되돌릴 조건:** 공용 `GET /jobs/{id}`가 생기면 `/scrap-requests/{id}`는 그 `Job`의 수집 전용 보기로 남깁니다

### 재시도 판정식 하나

- **결정:** 인증서 연동은 인증서 `ACTIVE`일 때만, 그 밖에는 마지막 결과의 `isRetryable`(없으면 참). 연동·항목마다 판정합니다(scrap-retryable 1·2·3·5)
- **검토한 대안:** 기관 종류별 클라이언트 식을 서버로 그대로 옮기기
- **선택 이유:** 종류마다 다른 기본값은 의도라기보다 화면마다 따로 짠 결과로 보입니다. 버튼은 `SCRAP`(첫·정기)과 `RETRY`(실패 후)로 나눠 같은 의미를 보존합니다
- **가정과 되돌릴 조건:** 특정 기관에서 결과 없는 연동의 수동 수집을 막아야 한다면(예: PG 첫 수집은 익일 10시만) 기관별 정책으로 `SCRAP`을 끕니다

### 등록은 동기 확인까지만

- **결정:** 등록 요청은 기관 로그인 확인(후보 조회 포함)까지만 동기로 하고, 첫 수집은 수집 요청으로 분리합니다(integration-registration-limits 6)
- **검토한 대안:** 등록 전체를 `Job`으로, 현행처럼 첫 수집까지 동기
- **선택 이유:** 잘못된 비밀번호는 바로 알려야 하고, 수집은 오래 걸립니다
- **가정과 되돌릴 조건:** 수집 업체의 로그인 확인 자체가 수십 초를 넘으면 등록도 `Job`으로 바꿉니다

### 쿨다운 단위는 기관 종류

- **결정:** 쿨다운은 회사 × 기관 종류입니다(scrap-cooldown 2)
- **검토한 대안:** 연동 단위, 항목 단위
- **선택 이유:** 현행과 같고, 수집 업체 호출 한도를 넘지 않는 가장 보수적인 선택입니다
- **가정과 되돌릴 조건:** 항목 하나 재수집이 잦다는 요구가 있으면 `itemKey`가 있는 요청만 항목 단위 쿨다운으로 바꿉니다. `scrap-cooldown.ts`와 저장소의 `latest` 조회 키만 고칩니다

### 연동 항목은 ID 없이 기관 키로

- **결정:** 카드·계좌·매장은 별도 ID 없이 기관이 준 `key`로 식별합니다(`/integrations/{id}/items/{itemKey}`)
- **검토한 대안:** 항목마다 접두사 ID(`itm_`)
- **선택 이유:** 공유 ID 접두사 목록을 바꾸지 않고 시작할 수 있고, 수집 레코드가 이미 기관 키로 항목을 가리킵니다
- **가정과 되돌릴 조건:** Bookkeeping 계좌(`bka_`)가 연동 항목을 참조해야 하면 `integrationItem` 접두사를 추가합니다

## 구현 상태

| 규칙 | 코드 | 픽스처 테스트 | 옮기지 않은 케이스 |
|---|---|---|---|
| [scrap-cooldown](#scrap-cooldown) | [scrap-cooldown.ts](../../../apps/api/src/modules/integrations/scrap-requests/scrap-cooldown.ts), [scrap-requests.ts](../../../apps/api/src/modules/integrations/scrap-requests/scrap-requests.ts) | [scrap-cooldown.fixtures.test.ts](../../../apps/api/src/modules/integrations/scrap-requests/scrap-cooldown.fixtures.test.ts) | 연동 없음 400·없는 ID 404 2건. HTTP 테스트가 422·404로 검사합니다 |
| [scrap-retryable](#scrap-retryable) | [scrap-retry.ts](../../../apps/api/src/modules/integrations/integrations/scrap-retry.ts), [integrations.ts](../../../apps/api/src/modules/integrations/integrations/integrations.ts)의 `integrationView` | [scrap-retry.fixtures.test.ts](../../../apps/api/src/modules/integrations/integrations/scrap-retry.fixtures.test.ts) | 없음 |
| [certificate-eligibility](#certificate-eligibility) | [certificate-eligibility.ts](../../../apps/api/src/modules/integrations/certificates/certificate-eligibility.ts), [certificates.ts](../../../apps/api/src/modules/integrations/certificates/certificates.ts) | [certificate-eligibility.fixtures.test.ts](../../../apps/api/src/modules/integrations/certificates/certificate-eligibility.fixtures.test.ts) | 없음. 표시 문구는 분류(`CERTIFICATE_OIDS`)로 검사합니다 |
| [integration-registration-limits](#integration-registration-limits) | [registration-limits.ts](../../../apps/api/src/modules/integrations/integrations/registration-limits.ts), [integrations.ts](../../../apps/api/src/modules/integrations/integrations/integrations.ts) | [registration-limits.fixtures.test.ts](../../../apps/api/src/modules/integrations/integrations/registration-limits.fixtures.test.ts) | 없음 |
| [chat-channel-token](#chat-channel-token) | [channel-token.ts](../../../apps/api/src/modules/integrations/messenger-channels/channel-token.ts), [messenger-channels.http.ts](../../../apps/api/src/modules/integrations/messenger-channels/messenger-channels.http.ts) | [channel-token.fixtures.test.ts](../../../apps/api/src/modules/integrations/messenger-channels/channel-token.fixtures.test.ts) | 링크 해석 2건, 소속 아닌 회사 1건, 문장 매칭 1건. 이유는 테스트 파일의 `NOT_PORTED`에 있습니다 |
