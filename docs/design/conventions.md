# API 규약

모든 모듈이 따르는 형태 규칙입니다. 현행 API에서 같은 개념이 여러 형태로 표현되던 문제(P4)를 없애는 것이 목적입니다.

## 경로

- **리소스는 영문 kebab-case 복수형입니다.** `/employees`, `/payroll-ledgers`, `/bank-transactions`
  - 현행 화면 이름이 드러난 경로(`/home/summary-cards`, `/employment/wage-employees/count-by-status`)는 리소스와 쿼리로 바꿉니다
- **버전은 경로 맨 앞 하나만 둡니다.** `/v1/...`. 리소스 중간의 `v2`(`/integrations/v2/`, `/api/v2/company/:id/giros/:id/payment`)는 두지 않습니다
- **회사 ID는 경로에 넣지 않습니다.** 액세스 토큰 하나가 회사 하나에 묶이고, 서버가 토큰에서 회사를 정합니다. 현행 `/api/company/:companyId/...` 접두와 nexus·sf 회사 ID 두 개를 없앱니다. 회사를 바꾸려면 `POST /auth/sessions:switch-company`로 토큰을 새로 받습니다 ([identity-access.md](identity-access.md#세션과-토큰))
  - 예외는 세무 대리인의 `/agency/*` 하나입니다. 회사에 묶이지 않은 대리인 범위 토큰으로만 부르고, 담당 회사를 가로지르는 읽기만 합니다. 회사를 고를 때는 `?companyId=` 쿼리로 거릅니다 ([agency-queue.md](agency-queue.md))
- **중첩은 소유 관계일 때 한 단계만 둡니다.** `/employees/{employeeId}/leaves`는 목록·생성만 받고, 개별 휴직은 `/leaves/{leaveId}`로 다룹니다
- **경로 변수 이름은 리소스 이름 + `Id`입니다.** `{employeeId}`, `{ledgerId}`. `:id`, `:cid`가 섞이지 않게 합니다
- **끝 슬래시를 붙이지 않습니다.** 현행 Django식 `/foo/`는 받지 않습니다
- **삭제는 `DELETE`, 일괄 처리는 `POST /{resource}:batchUpdate` 같은 컬렉션 커맨드입니다**

## 필드와 값

- **JSON 키는 영문 camelCase입니다.** 요청·응답·멀티파트 필드 모두 같습니다. 클라이언트가 키를 변환하는 인터셉터와 `LEGACY_RAW_KEYS` 같은 예외를 없앱니다
  - 업무 용어와 영문 키의 대응은 각 도메인 문서의 **용어** 표에 둡니다([코드의 용어](#코드의-용어)). 화면 표시 문자열은 클라이언트의 i18n 사전이 맡습니다
- **enum 값은 영문 `SCREAMING_SNAKE_CASE`입니다.** `ACTIVE`, `PENDING_APPROVAL`. 현행 한글 상태(`임시저장`, `퇴사처리중`)와 소문자(`request`, `done`), 대소문자 혼재 코드를 없앱니다
  - 국세청·4대보험이 정한 코드값(상실사유 코드, 소득 구분 코드, 업종코드)은 원래 값을 그대로 쓰고 필드 이름에 `Code`를 붙입니다
- **날짜는 `YYYY-MM-DD`, 달은 `YYYY-MM`, 시각은 오프셋을 포함한 RFC 3339입니다**
  - 입사일·지급일처럼 "그날"이 의미인 값은 `date`(`2026-11-01`), 귀속월·과세기간처럼 달이 단위인 값은 `month`(`2026-11`), 시점은 `dateTime`으로 구분합니다
  - 업무 시간대는 `Asia/Seoul`이고, 서버가 "오늘", 신고 기한, 귀속월 경계를 그 시간대로 계산합니다
- **금액은 원 단위 정수입니다.** 공급가액·세액처럼 함께 다니는 금액은 `{ supplyAmount, vatAmount }`처럼 이름을 붙여 한 객체에 둡니다
- **요율은 ppm 정수(`1% = 10000`)입니다.** 필드 이름에 `RatePpm`을 붙입니다. 3.595%처럼 bp로 담을 수 없는 요율이 있어서입니다
- **불리언 대신 상태 enum을 우선합니다.** 상태를 나타내는 플래그 여러 개는 `status` 하나로 합칩니다
- **주민등록번호·계좌번호는 응답에 기본으로 넣지 않습니다.** 목록·상세 응답에는 `registrationNumberMasked`(`900101-1******`), `accountNumberMasked`(끝 4자리)만 넣고, 원문은 사유를 받는 별도 엔드포인트로만 줍니다 ([compliance.md](compliance.md#개인정보-최소-노출))

## 응답 형태

envelope 없이 리소스 자체를 돌려줍니다. 현행 DRF 봉투 `{count, next, previous, results}`를 없앱니다.

```jsonc
// GET /v1/employees/emp_01J...  → 200
{ "id": "emp_01J...", "name": "김민준", "status": "JOINED", "version": 3, ... }

// GET /v1/employees?status=JOINED  → 200
{ "items": [ ... ], "nextCursor": "eyJ...", "totalCount": 42 }
```

- **ID는 접두사가 붙은 불투명 문자열입니다.** `cmp_`, `emp_`, `pyl_`(급여대장), `fil_`(신고 건), `evd_`(증빙). 전체 목록은 `apps/api/src/shared/ids/ids.ts`에 있습니다. 현행처럼 숫자 ID와 문자열 ID가 도메인마다 다르지 않습니다
- **상세 응답에는 `allowedActions`를 넣습니다.** 클라이언트가 버튼을 켜고 끄는 근거입니다

```jsonc
{
  "id": "pyl_01J...",
  "status": "PENDING_APPROVAL",
  "allowedActions": ["APPROVE", "REJECT"],
  "warnings": [{ "code": "BELOW_MINIMUM_WAGE", "message": "Row 3 pays below the minimum wage." }]
}
```

## 페이지네이션

목록은 모두 커서 방식 하나만 씁니다. 현행 DRF `limit/offset`을 대체합니다.

| 쿼리 | 의미 |
|---|---|
| `limit` | 1–200, 기본 50 |
| `cursor` | 앞 응답의 `nextCursor` |
| `sort` | `field` 또는 `-field` (리소스별 허용 목록) |

- `totalCount`는 비용이 큰 목록에서는 `?includeTotal=true`일 때만 계산합니다
- 탭 건수(분류됨·미분류)처럼 화면이 함께 보는 집계는 목록 응답에 섞지 않고 `GET /{resource}:count?groupBy=status` 같은 집계 엔드포인트로 줍니다
- 엑셀 내보내기처럼 전체가 필요한 경우에는 클라이언트가 끝까지 반복 조회하지 않고 `Export` 작업([작업](#비동기-작업))을 만듭니다
- 구현은 `apps/api/src/shared/http/pagination.ts`(`PageQueryFields`, `Page`, `paginate`)를 씁니다

## 오류

[RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457)를 씁니다.

```jsonc
// 409
{
  "type": "urn:semu:problem:payroll-ledger-closed",
  "title": "Payroll ledger is closed",
  "status": 409,
  "code": "PAYROLL_LEDGER_CLOSED",
  "detail": "Ledger pyl_01J... was closed on 2026-11-10.",
  "violations": [{ "field": "rows[2].basePay", "code": "BELOW_MINIMUM_WAGE" }]
}
```

- `type`은 `urn:semu:problem:<code-kebab>`입니다(`problemType(code)`)
- `code`는 영문 상수이고 도메인 문서마다 목록을 둡니다. 현행 `token is invalid` 같은 문장 매칭과 `DUPLICATE_EMPLOYEE`·`nps_under_60h_enrolled` 형식 혼재를 정리합니다
- 사용자에게 보일 문장은 클라이언트가 `code`로 고릅니다. `detail`은 개발자용입니다
- **요청 형식 오류는 400 `VALIDATION_FAILED`입니다.** 경로·쿼리·헤더·본문이 스키마를 통과하지 못하면 첫 오류에서 멈추지 않고 모든 위반을 `violations`에 담습니다
  - `field`는 JSON 경로(`rows[1].basePay`)입니다. 값 전체가 잘못됐으면 요청 부분 이름(`path`, `query`, `headers`, `body`)을 씁니다
  - `code`는 `REQUIRED`(빠짐), `INVALID_TYPE`(타입이 다름), `INVALID_VALUE`(형식·범위·허용값이 아님), `UNKNOWN_FIELD`(정의되지 않은 필드) 중 하나입니다. 지금은 정의되지 않은 필드를 무시하므로 `UNKNOWN_FIELD`는 나오지 않습니다
  - 형식은 맞지만 업무 규칙에 어긋나는 요청은 409/422와 도메인 `code`로 구분합니다. 409는 현재 상태와 충돌(`*_TRANSITION_INVALID`, 중복), 422는 입력 값 자체가 규칙에 어긋남(기간 겹침, 한도 초과)입니다
- **인증·인가 오류**: 401 `UNAUTHENTICATED`, 403 `TOKEN_SCOPE_MISMATCH`(`requiredScope`), 403 `PERMISSION_DENIED`(`permission`), 403 `ENTITLEMENT_REQUIRED`(`requiredPlans`), 403 `TERMS_REAGREEMENT_REQUIRED`(`termCodes`)
- **검증 전용 엔드포인트를 두지 않습니다.** 현행 `/pre-signup/check-email-duplicate`, `/pre-signup/check/business_number`는 생성 요청의 409/422로 대체합니다
  - 입력 중 즉시 피드백이 필요한 곳(이메일 중복)은 `?dryRun=true`로 같은 생성 엔드포인트를 부릅니다. 검증 로직이 한 곳에만 있게 됩니다

## 커맨드

상태 전이와 여러 엔티티에 걸친 업무는 **커맨드 엔드포인트**로 받습니다. 형식은 `POST /{resource}/{id}:{command}`입니다.

```
POST /v1/payroll-ledgers/pyl_01J...:approve
POST /v1/filings/fil_01J...:submit
POST /v1/esign-requests/esr_01J...:send
```

- **언제 커맨드를 쓰는가:** 서버가 전이 가능 여부를 판정해야 하거나, 부수효과(다른 리소스 변경·이벤트·외부 호출)가 있을 때입니다
- **언제 PATCH를 쓰는가:** 업무 규칙 없이 값만 바꿀 때입니다 (메모 내용, 표시 이름)
- `PATCH {status: "..."}`로 상태를 바꾸는 형태는 쓰지 않습니다. 어떤 전이인지 경로에서 드러나지 않고, 전이마다 필요한 입력(반려 사유 등)을 검증하기 어렵습니다
- 커맨드 응답은 바뀐 주 리소스입니다. 함께 바뀐 리소스는 이벤트로 알립니다
- 라우터는 `::`를 콜론 문자로 읽으므로 경로 정의는 `/:ledgerId::approve`입니다

## 멱등성

외부 효과가 있거나 돈이 오가는 POST는 `Idempotency-Key` 헤더를 필수로 받습니다. 없으면 428 `IDEMPOTENCY_KEY_REQUIRED`입니다.

- **대상:** 결제·재결제, 지로 납부, 세금계산서 발행, 전자서명 발송, 증명서 발급, 메일·알림톡 발송, 수집 요청, 급여 이체 파일 생성
- 같은 키로 24시간 안에 다시 오면 처음 응답을 그대로 돌려줍니다. 24시간이 지난 키는 새 요청으로 처리합니다
- 키의 범위는 회사와 행위자(사용자)입니다. 같은 회사의 다른 사용자가 같은 키를 써도 서로의 응답을 받지 않습니다
- 같은 키에 본문이 다르면 422 `IDEMPOTENCY_KEY_REUSED`입니다. 본문은 객체 키를 정렬한 JSON의 SHA-256 지문으로 비교합니다(배열 순서는 그대로 봅니다)
- 같은 키의 앞 요청이 아직 처리 중이면 409 `IDEMPOTENCY_KEY_IN_PROGRESS`입니다. 끝난 뒤 같은 키로 다시 보내면 처음 응답을 받습니다
- 키는 외부 효과보다 먼저 확인하고 예약합니다(확인 → 예약 → 처리 → 결과 기록). 처리가 중간에 실패하면 이미 일어난 외부 효과를 항목별로 기록해 두고, 같은 키의 재시도는 그 항목을 건너뜁니다
- **지금 구현:** 위 규칙을 모두 따르는 것은 `POST /payslips:send`, 결제 재시도·환불(`/payments/{id}:retry`·`:refund`), 출금 계좌 등록(`POST /billing-mandates`), 지로 납부(`/giros/{id}:pay`), 세금계산서 발행(`POST /tax-invoices`)입니다. 수집 요청(`integrations`)은 자기 방식으로 키를 재생하고, 전자서명 발송·증명서 발급은 아직 키를 받지 않습니다
  - 공통 도우미는 `apps/api/src/shared/http/idempotency.ts`의 `runIdempotent`(확인 → 예약 → 처리 → 결과 기록)·`outcomeUnknownOnDefect`·`requestFingerprint`·`idempotencyExpired`와 `shared/persistence/idempotency-store.ts`의 요청 기록 표(`makeIdempotencyStore`)입니다. 표는 컨텍스트마다 하나(`billing_idempotency_keys`, `bookkeeping_idempotency_keys`)이고 ID는 `<회사>:<사용자>:<키>`입니다. 명세서 발송은 건별 결과를 담는 자기 표(`payroll_payslip_sends`)를 그대로 씁니다
  - 지문에는 엔드포인트 이름과 경로의 리소스 ID를 함께 넣습니다. 같은 컨텍스트에서 같은 키를 다른 결제나 다른 커맨드에 쓰면 422입니다. 다른 컨텍스트의 표와는 섞이지 않습니다
  - 지문은 저장되고 짧은 값의 SHA-256은 거꾸로 찾을 수 있으므로 비밀 값은 넣지 않습니다. 출금 계좌 등록은 은행·예금주·가린 계좌번호(끝 4자리)만, 지로 납부는 고지서·은행·계좌 끝 4자리만 봅니다(계좌번호 전체·비밀번호·납부자 번호 제외). 그래서 끝 4자리가 같은 다른 계좌는 같은 요청으로 봅니다
  - 응답은 처음 응답 본문을 기록에 저장했다 그대로 돌려줍니다. 그 사이 리소스가 바뀌었어도(세금계산서 `:sync` 등) 재생은 처음 응답이고, `If-Match`도 다시 보지 않습니다
  - **실패하면 키를 남기지 않습니다.** 검증·상태 오류와 외부 기관의 거절(`MANDATE_REJECTED`, `GIRO_PAYMENT_FAILED`, `TAX_INVOICE_REJECTED`) 모두 예약을 지우므로, 같은 키로 요청을 고쳐 다시 보내면 실제로 다시 처리합니다(외부 기관도 다시 부릅니다). 거절된 시도 자체(거절 계좌, 납부 시도·고지서 이력, `FAILED` 발급 건)는 `keepChanges`로 남깁니다
  - **결과를 모르면 키를 지킵니다.** 외부 기관 호출과 그 결과 기록 구간에서 결함·중단이 나면(시간 초과, 5xx, 연결 끊김) 돈이 나갔거나 발급됐을 수 있습니다. 503 `EXTERNAL_OUTCOME_UNKNOWN`을 돌려주고 기록을 `UNCERTAIN`으로 `keepChanges`해 커밋합니다. 같은 키·같은 본문의 재시도는 같은 **멱등 참조**로 외부 기관을 다시 불러 결과를 받아 마치고, 그 뒤로는 그 응답을 재생합니다. 본문이 다르면 422입니다
  - **`UNCERTAIN`은 만료하지 않습니다.** 24시간 만료는 `COMPLETED`에만 있고, 끝난 시각(`finishedAt`)부터 셉니다. 결과를 모르는 기록을 만료시키면 같은 키가 새 요청이 되어 새 참조를 받고, 외부 기관이 같은 일을 다시 합니다(지로 이중 출금). 만료 뒤 예전 참조를 이어 쓰는 방법도 있지만, 그러면 "만료된 키는 새 요청"이라는 규칙에 예외가 생기고 본문 비교도 끊깁니다. 그래서 결과를 받아 끝낼 때까지 기록을 그대로 두는 쪽을 골랐습니다. 며칠 뒤 같은 키로 재시도해도 같은 참조로 이어 가고, 이어 마친 응답은 그때부터 24시간 재생합니다. `IN_PROGRESS`는 요청이 처리되는 동안에만 있습니다(SQLite는 요청이 끝날 때 커밋하거나 되돌리고, 메모리 저장소는 예약부터 결과 기록까지 중단할 수 없게 실행합니다)
  - 외부 기관 포트에는 클라이언트 키 원문이 아니라 시도마다 만든 멱등 참조(`IdempotentAttempt.reference`)를 넘깁니다(CMS `requestId`, 지로·홈택스 `idempotencyKey`). 다른 사용자가 같은 키를 써도 포트에서 섞이지 않고, 거절 뒤 다시 보낸 시도는 새 참조라 외부 기관이 앞 거절을 재생하지 않습니다. 포트 구현은 같은 참조의 재요청에 다시 처리하지 않고 처음 결과를 돌려줘야 합니다
  - 실제 기관은 같은 참조의 재요청을 "중복 거래" **거절**로 돌려주는 일이 많습니다. 어댑터는 이것을 거절로 넘기면 안 됩니다. 거절은 확정 실패라 키를 풀고, 다음 재시도가 새 참조로 같은 일을 한 번 더 하기 때문입니다. 원거래를 조회해 그 결과를 돌려주고, 조회하지 못하면 결함으로 끝냅니다(그러면 503이고 기록은 `UNCERTAIN`으로 남습니다). 참조는 UUID(36자)이고, 고정 길이 전문 필드에 맞추는 것은 어댑터의 몫입니다. 세 포트의 가짜(`layerFake`)도 참조마다 처음 결과를 기억합니다
  - 결과를 모르는 세금계산서 발행은 `ISSUING` 발급 건이 명세서를 잠급니다. 그 명세서에 누가 어떤 키로 발행을 보내든 그 발급 건에 저장한 참조로 홈택스에 다시 물어 마치므로, 처음 요청한 사람이 돌아오지 않아도 명세서가 풀리고 두 번 발급되지 않습니다([bookkeeping.md](bookkeeping.md#거래명세서와-세금계산서-발급))
  - 지로 납부는 고지서가 `TODO`로 남아 **다른 키로 다시 납부하면 막지 못합니다**. 결과를 모르는 납부는 같은 키(만료 없음)로 재시도해야 합니다
  - 이 규칙 이전의 키(지로 납부 시도 ID `<고지서>:<키>`, 세금계산서 발급 건의 `idempotencyKey`에 남은 키 원문)는 읽지 않습니다. 배포 전에 성공한 요청을 같은 키로 다시 보내면 재생 대신 리소스 상태로 거절됩니다(납부된 고지서는 409 `GIRO_TRANSITION_INVALID`, 발급된 명세서는 409 `SALES_TRANSACTION_LOCKED`). 실패했던 요청은 새로 처리합니다. 결제 재시도·환불·출금 계좌 등록은 이전에 키를 저장하지 않았습니다
  - **프로세스가 죽으면:** SQLite에서는 요청 전체가 트랜잭션 하나라, 외부 기관을 부르는 도중 프로세스가 죽으면 예약도 되돌려집니다. 같은 키의 재시도는 새 참조로 외부 기관을 다시 부릅니다. 외부 효과를 트랜잭션 밖으로 옮겨 예약을 먼저 커밋할 때 함께 닫습니다(아래 알려진 제약)
  - SQLite에서는 요청 하나가 `BEGIN IMMEDIATE` 트랜잭션이고 연결이 하나라, 같은 키의 다음 요청은 앞 요청이 커밋한 뒤에야 키를 확인합니다. 그래서 예약을 먼저 커밋하지 않아도 같은 키가 겹쳐 처리되지 않습니다. 메모리 저장소에는 트랜잭션이 없어 예약이 바로 보이고, 겹친 요청은 409를 받습니다
  - **열린 질문:**
    - 지로 납부도 게이트웨이를 부르기 전에 `PENDING` 납부 시도를 저장하면, 세금계산서의 `ISSUING`처럼 다른 키·다른 사용자의 납부를 막고 그 참조로 이어 갈 수 있습니다. 후속으로 둡니다
    - 계좌번호 지문은 끝 4자리만 봅니다. 서버 비밀키의 HMAC(예: 데이터 키에서 지문용 하위 키를 파생)으로 계좌번호 전체를 지문에 넣으면, 끝 4자리가 같은 다른 계좌에 같은 키를 쓴 실수도 422로 잡을 수 있습니다
    - 만료된 `COMPLETED` 기록은 같은 키가 다시 올 때 덮어쓸 뿐 지우지 않습니다. 응답 본문(예금주·가린 계좌 등)이 24시간 넘게 남으므로 만료 기록을 지우는 정리 작업이 필요합니다. `UNCERTAIN`은 지우지 않고 운영자가 보게 합니다
  - **알려진 제약:** 같은 이유로, 외부 효과를 요청 안에서 기다리는 동안 그 프로세스의 **모든** 요청(GET 포함)이 프로세스 잠금 뒤에 줄을 서고, 같은 파일을 연 다른 프로세스는 busy timeout(5초) 동안 기다리다 5xx로 실패합니다. 겹쳐 처리되지 않는 대가로 앱 전체가 멈추는 것입니다. 지금 외부 효과(메일, CMS 계좌 등록, 지로 납부, 세금계산서 발급)는 테스트에서 즉시 끝나는 가짜라 드러나지 않지만, 느린 실제 연동을 붙이기 전에 그 효과를 트랜잭션 밖(outbox·작업자, `RUNNING` Job)으로 옮겨야 합니다. 그때 예약은 먼저 커밋하고 409로 겹친 요청을 막습니다

## 동시성

같은 회사를 고객 직원과 세무 대리인이 함께 다루는 것이 일상입니다.

- 수정 가능한 리소스는 `version` 정수를 가집니다. 응답의 `ETag: "7"`을 다음 요청의 `If-Match: "7"`로 보내고, 어긋나면 412 `VERSION_MISMATCH`(`currentVersion`)를 돌려줍니다
- 상태 커맨드는 `If-Match`를 받습니다. 헤더가 없으면 버전을 검사하지 않습니다
- 사업자번호·이메일처럼 유일해야 하는 값은 저장소의 유일 제약으로 보장합니다. "검증 → 저장" 사이 경쟁 조건을 없앱니다
  - **지금 구현:** 표가 `(id, company_id, data)`뿐이라 유일 제약이 없습니다. SQLite 연결 하나에서 요청 트랜잭션을 한 번에 하나씩 열기 때문에 "검증 → 저장"이 겹치지 않을 뿐입니다. 이메일 조회도 표 전체를 훑습니다. 인스턴스를 늘리거나 동시 쓰기를 열 때 그 값들을 열로 빼고 유일 색인을 둡니다
- 구현은 `apps/api/src/shared/http/versioning.ts`(`expectedVersion`, `checkVersion`, `withEtag`)를 씁니다

## 비동기 작업

오래 걸리거나 외부 기관에 의존하는 일은 `Job` 리소스로 만듭니다.

```
POST /v1/scrap-requests                  → 202 { "jobId": "job_01J..." }
GET  /v1/jobs/job_01J...                 → { "status": "RUNNING", "progress": 0.4 }
```

| `status` | 의미 |
|---|---|
| `QUEUED` | 접수됨 |
| `RUNNING` | 처리 중 |
| `SUCCEEDED` | 완료, `result`에 결과 |
| `PARTIALLY_SUCCEEDED` | 일부 항목 실패, `result.items[].status`에 항목별 결과 |
| `FAILED` | 실패, `error`에 Problem Details |
| `CANCELED` | 취소됨 |

- 끝나면 `job.completed` 이벤트를 보냅니다 ([events.md](events.md)). 클라이언트는 폴링 대신 이벤트를 받습니다
- 현행 수집 폴링(`PROGRESS|SUCCESS|FAIL`), 분류 규칙 일괄 적용(`rule_apply_jobs`), 엑셀 업로드, 내보내기가 모두 이 형태가 됩니다

## 감사와 열람 기록

- 모든 쓰기 요청은 감사 로그에 `actor`, `company`, `resource`, `action`, `before/after 해시`, `ip`를 남깁니다. 세무 대리인의 동작은 `actor.kind = AGENCY`로 구분합니다
- 주민등록번호·계좌번호 원문 조회, 급여 명세 열람, 엑셀 다운로드는 `X-Access-Reason` 헤더를 필수로 받고 열람 기록을 남깁니다

## 코드 구조

- 컨텍스트 하나가 `apps/api/src/modules/<context>/` 폴더 하나입니다. 컨텍스트는 `<context>.api.ts`(HTTP 계약)와 `<context>.layer.ts`(`<Context>HttpLive`, `<Context>StoreLive`, `<Context>MemoryLive`)를 내보냅니다
- 컨텍스트 안의 리소스 하나는 하위 폴더 하나입니다. 파일 역할은 다음과 같습니다

| 파일 | 내용 |
|---|---|
| `<resource>.ts` | 스키마(`Schema.Struct`)와 도메인 오류(`HttpApiError.Problem`) |
| `<rule>.ts`, `<rule>.types.ts` | 순수 규칙 함수(상태 전이표, 계산). Effect에 의존하지 않습니다 |
| `<resource>-repository.ts` | 저장소 서비스(`Context.Service`). `layer(seed)`는 `TableFactory`로 표를 만들고, `layerMemory(seed)`는 그것을 메모리 표로 채운 것입니다 |
| `<resources>.ts` | 유스케이스 서비스. 권한 확인, 규칙 호출, 저장 |
| `<resources>.api.ts` | 엔드포인트 그룹(`HttpApiGroup`) |
| `<resources>.http.ts` | 핸들러(`HttpApiBuilder.group`) |
| `*.test.ts`, `*.http.test.ts`, `*.fixtures.test.ts` | 규칙 단위 테스트, HTTP 테스트, 규칙 픽스처 테스트 |

- **다른 컨텍스트의 저장소를 직접 읽지 않습니다.** 필요한 것은 쓰는 쪽이 포트(`Context.Service`)로 선언하고, 제공하는 쪽이 공개 서비스(`<context>.public.ts`)를 내보냅니다. 둘을 잇는 어댑터는 `apps/api/src/wiring/<consumer>-<provider>.ts`에 두고, `wiring.layer.ts`의 `WiringLive`로 묶어 `app.ts`에서 연결합니다
  - 어댑터와 핸들러는 컨텍스트마다 하나뿐인 저장소 인스턴스를 함께 씁니다. 각 컨텍스트의 `<Context>MemoryLive`에 있는 다른 컨텍스트 포트의 가짜는 그 컨텍스트 단위 테스트에서만 씁니다
- **저장은 `src/shared/persistence/`를 거칩니다.**
  - 저장소는 `TableFactory.make('<context>_<collection>', { seed, companyOf })`로 표를 만듭니다. 표는 `(id, company_id, data JSON)`이고 메모리·SQLite 구현이 같은 동작을 합니다. 레코드는 불변 순수 데이터여야 합니다(`Set`·`Map`·`bigint`까지 보존)
  - SQLite는 시드를 표마다 한 번만 넣고 `semu_meta`에 `seeded:<표>`를 남깁니다. 데모 행을 모두 지워도 재시작 때 되살아나지 않습니다. 표시가 없는 이전 데이터베이스는 표가 비어 있을 때만 넣습니다. 시드가 없는 표에는 표시를 남기지 않아 나중에 더한 시드도 들어갑니다. 표시 확인과 시드는 `BEGIN IMMEDIATE` 트랜잭션 안에서 해, 같은 파일을 연 두 프로세스가 겹치면 뒤의 프로세스가 busy timeout 동안 기다렸다가 표시를 보고 넘어갑니다. 시드 ID가 겹치면 실패합니다
  - 요청 하나가 트랜잭션 하나입니다(`UnitOfWorkMiddleware`). 응답이 4xx·5xx이면 되돌립니다. 저장소와 유스케이스는 트랜잭션을 직접 열지 않습니다
  - 실패 응답과 함께 남아야 하는 기록(로그인 실패 횟수, 서명자 확인 실패, 거절된 출금 계좌·세금계산서·지로 납부 시도, 그 감사 기록)은 쓴 뒤 `keepChanges`를 부르고 바로 실패를 돌려줍니다. 결함(5xx)이면 그래도 되돌립니다
  - 컨텍스트 사이 이벤트는 어댑터가 `Outbox.channel(name, handler)`로 냅니다. SQLite에서는 같은 트랜잭션에 기록하고 커밋 뒤 전달하며, 실패하면 릴레이가 다시 넘깁니다. 소비자는 멱등이어야 합니다
    - 시도할 때마다 `outbox.attempts`를 늘리고, 실패하면 `last_error`에 결함 요약(오류 이름과 코드 위치, 메시지 없음)을 남깁니다. 한 행이 실패해도 릴레이는 다음 행으로 넘어갑니다. 전달 트랜잭션을 열지 못해(다른 프로세스가 쓰기 잠금을 busy timeout보다 오래 쥠) 소비자를 부르지도 못했으면 시도로 세지 않고 `Outbox delivery not started` 경고만 남깁니다
    - `OUTBOX_MAX_ATTEMPTS`(5)번 실패하면 `dead_at`을 찍은 죽은 이벤트가 되고, 릴레이는 더는 넘기지 않습니다. 그때 한 번 `Outbox event dead` 로그(행 `seq`·`id`·채널·시도 횟수·결함 요약)를 남깁니다. 릴레이가 30초마다 돌므로 계속 죽는 소비자는 몇 분 안에 멈춥니다
    - 열(`attempts`·`last_error`·`dead_at`)이 없는 이전 `outbox` 표는 시작할 때 `ALTER TABLE`로 더합니다(`BEGIN IMMEDIATE` 안에서 확인하므로 여러 번 열어도 같습니다). `attempts`·`last_error`는 outbox를 처음 넣을 때(`08fa0a6`)부터 있었으므로 실제 업그레이드에서 더해지는 열은 `dead_at`뿐입니다. 이미 `attempts`가 한도 이상인 행은 업그레이드 뒤 한 번 더 넘겨 보고, 또 실패하면 바로 죽은 이벤트가 됩니다
    - 운영자는 죽은 이벤트를 찾아 원인(소비자 결함)을 고친 뒤 표시를 지워 다시 넘깁니다. 다음 릴레이(시작 때와 30초마다)가 넘깁니다. 아래처럼 `attempts`·`last_error`도 지우면 처음 시도처럼 다시 5번까지 넘겨 봅니다. 실패 이력을 남겨 두려면 `dead_at`만 지우되, 그러면 한 번만 더 실패해도 다시 죽습니다

      ```sql
      -- 죽은 이벤트 찾기
      SELECT seq, id, channel, attempts, last_error, created_at, dead_at FROM outbox WHERE dead_at IS NOT NULL ORDER BY seq;
      -- 고친 뒤 다시 넘기기: 123을 위에서 찾은 seq로 바꿉니다(바뀐 행이 1이어야 합니다)
      UPDATE outbox SET dead_at = NULL, attempts = 0, last_error = NULL WHERE seq = 123 AND dead_at IS NOT NULL;
      ```

    - 메모리 저장소(`Outbox.layerDirect`)는 저장하지 않고 바로 소비자를 부르므로 재시도·죽은 이벤트가 없습니다. 소비자 결함은 이벤트를 낸 쪽으로 그대로 올라갑니다
  - `app.ts`의 `MemoryLive`(테스트·로컬)와 `SqliteLive(file, key)`(서버 기본 `data/semu.sqlite`·`data/semu.key`, `SEMU_DATABASE`·`SEMU_DATA_KEY`)가 같은 저장소 조합을 씁니다. `pnpm test:sqlite`는 모든 테스트를 SQLite로 돌립니다
- HTTP 테스트는 `src/shared/testing/http-test-app.ts`의 `httpTestApp({ tokens, layers, basePath, defaultToken })`으로 앱 전체를 `TestStoreLive` 위에 띄웁니다. 요청 옵션은 `body`, `token`, `cookie`, `ifMatch`, `idempotencyKey`, `headers`이고, `json()`은 상태·헤더·본문을 함께 돌려줍니다. 컨텍스트 도우미는 이것 위에 토큰 표와 포트 가짜 레이어만 얹습니다
- 인증이 필요한 그룹은 `.middleware(Authentication)`을 붙이고, 핸들러 맨 앞에서 `authorize({ permission, plans, requiresTerms })`를 부릅니다
  - `/agency/*` 그룹은 `.middleware(AgencyAuthentication)`을 붙이고 `authorizeAgency({ permission, plans })`가 돌려준 담당 회사만 읽습니다
  - 권한 타입은 카탈로그(`identity-access/permissions/permission-catalog.ts`)에서 만듭니다. 요구 권한은 `Permission`(카탈로그의 `resource:action` 리터럴 유니온)이라 오타는 `tsc`가 잡고, 행위자가 가진 권한은 와일드카드(`resource:*`, `*`)를 더한 `GrantedPermission`입니다. 저장소·요청에서 온 문자열은 캐스트하지 않고 `isGrantedPermission`·`isGrantable`로 거릅니다

## 코드의 용어

업무 용어를 코드로 옮길 때 번역이 흩어지면 문서와 코드가 어긋납니다. 번역은 한 곳에 묶고, 사람이 읽는 곳은 한글로 씁니다 (2026-11-08). 같은 규약을 먼저 적용해 본 다른 학습 저장소(hemr)의 결정을 따랐습니다. 규칙 계산은 법령·고시와 한 줄씩 맞춰 봐야 해서 법령 용어를 그대로 쓰면 대조하기 쉽고, 사람은 함수·상수 목록(아웃라인)으로 구조를 파악할 때 한글이 더 쉽습니다. 코드 입력은 에이전트가 하므로 한/영 전환은 비용이 아니고, 토큰이 더 드는 것은 감수합니다. JSON 키·enum 값을 영문으로 두는 [필드와 값](#필드와-값) 규약은 그대로입니다.

- **도메인 문서의 용어 표가 번역의 단일 출처입니다.** 업무 개념을 나타내는 새 식별자(형, 상태 값, 커맨드, 필드)는 그 도메인 문서의 `## 용어` 표에 먼저 올리고 씁니다. 표에 없는 번역어를 새로 짓지 않습니다
  - 한 한글 용어가 다른 키 둘을 가리키거나 한 키가 모듈마다 다른 뜻이면 표에 각각 적고 무엇이 다른지 적습니다
  - 영문 대응어가 없는 제도 용어는 새 영어 낱말을 짓지 않고 국세청·공단의 코드 이름을 따릅니다([필드와 값](#필드와-값)의 `Code` 규칙)
  - [glossary.md](glossary.md)는 업무 개념이 현실에서 무엇인지 풉니다. 그 문서에 나오는 코드 이름은 개념이 모델링된 곳을 가리키는 길잡이일 뿐 번역의 출처가 아닙니다. 둘이 다르면 용어 표가 맞고 glossary.md를 고칩니다
- **테스트 설명(`describe`·`it`)은 한글로 씁니다.** 실패 메시지가 업무 규칙 문장으로 읽히게 합니다. 예: `it('근속 1년 미만이면 퇴직금이 0원입니다')`. 픽스처 사례 이름(`'%s'`로 넣는 값)은 데이터라 그대로 둡니다. 이 규약을 넣을 때 영문이던 설명은 컨텍스트 묶음별 후속 PR로 옮깁니다
- **식별자와 외부 계약은 영문입니다.** 내보내는 이름(함수·형·상수)과 내보내는 함수의 매개변수, 입력·결과 필드, 형의 리터럴(enum 값), HTTP 경로·필드, 오류 코드, 이벤트 타입, 저장소 표 이름, 파일 이름은 영문입니다. 파일 이름은 유니코드 정규화(macOS NFD, Linux NFC) 차이로 git에서 깨질 수 있어서이기도 합니다
- **한글 식별자는 규칙 계산 모듈 안에서만 씁니다.** 규칙 계산 모듈은 Effect에 의존하지 않는 순수 규칙 파일([코드 구조](#코드-구조)의 `<rule>.ts`: 상태 전이표, 세액·보험료·기한 계산, 판정)입니다. 그 안의 내보내지 않는 함수·상수, 지역 변수, 콜백 매개변수를 법령·국세청·공단 용어로 씁니다. 예: `근속연수공제`, `환산급여`, `과세표준`
  - 내보내지 않는 형(`interface`·`type`)은 영문입니다. 필드가 영문 키라 형 이름만 한글이면 오히려 섞입니다
  - 업무 용어가 아닌 도구(날짜·시각 계산, 범용 버림·반올림 함수, 정렬·비교, 해시, 문자열 정리)와 하나만 들고 도는 반복 변수(`row`, `line`), 결과 키를 그대로 받는 이름(`errors`, `warnings`)은 영문입니다. 콜백의 반복 요소와 내보내지 않는 함수의 매개변수는 그 값의 형 이름(`filing`, `row`, `line`, `status`)으로 부르면 영문, 형 이름이 아닌 업무 값(서식 코드, 번호의 앞자리, 약관 코드)을 들면 한글로 씁니다 다만 법령이 정한 끝수 처리(지방소득세 10원 미만 절사, 소액부징수)는 업무 규칙이라 그 규칙을 담은 상수·판정은 한글로 씁니다
  - 서비스(`<resources>.ts`)·저장소·핸들러·어댑터는 영문입니다. 한글이 HTTP·저장 코드까지 번지지 않게 합니다
  - 한글 식별자는 용어 표의 한글 용어를 따르되 표에 행을 더하지 않습니다. 표는 업무 용어와 영문 키의 대응이고, 내보내지 않는 한글 이름은 번역이 없기 때문입니다. 표에 없는 용어는 그 규칙의 규칙 문서(`docs/reference/rules/<규칙>.md`)가 쓰는 말을, 거기에도 없으면 법령 용어를 따르고, 새로 지은 말은 주석으로 뜻을 밝힙니다
- **이름 짓기.** ① 경계와 방향을 남깁니다(`이하`·`미만`, 그날 포함 여부, `시작`·`종료`·`상한`). ② 이름이 코드보다 많이 말하지 않게 합니다. ③ 금액과 여부를 구분합니다(판정 함수는 `~인가`·`~임`으로 끝냅니다). ④ 단위를 밝힙니다(`월`, `원`, `ppm`). ⑤ 용어 표가 동음이의로 표시한 말은 구분해 다 씁니다. ⑥ 같은 뜻은 한 어간으로 씁니다. ⑦ 법령 용어를 줄일 때는 그 안에서 줄입니다(퇴직소득 계산 안에서 `퇴직소득산출세액` → `산출세액`)
- **주의할 점.** prettier는 한글을 두 칸으로 셉니다(120칸 넘침). 이름을 법령 용어 안에서 짧게 고르거나 조건을 나눠 씁니다. 맞춤법 변형(띄어쓰기, `율`·`률`)은 식별자면 `tsc`가 잡지만 문자열·객체 키는 못 잡으므로, 외부 계약을 영문으로 두는 이유가 됩니다
- **넓힐 조건과 되돌릴 조건.** 내보내는 이름까지 한글로 넓히는 것은 서비스·HTTP 코드에 한글이 섞여 경계가 흐려지므로 미룹니다. 저장소 주인이 서비스 코드의 아웃라인도 한글로 읽고 싶다고 하면 다시 봅니다. 맞춤법 변형으로 버그가 한 번이라도 나오거나 저장소 주인이 읽기 불편하다고 하면 영문으로 되돌립니다. 이름만 바꾸는 일이라 비용이 작습니다

## 예시 규칙

문서의 예시 경로는 `/v1` 접두사를 생략합니다.
