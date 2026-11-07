# 규칙 결정: Tax

신고 건·세무 일정·할 일 카드·예상 부가세 규칙 7개의 열린 질문 41개에 대한 서버 결정입니다. 설계는 [tax.md](../tax.md)에 있습니다. 읽는 법은 [README](README.md#읽는-법)를 따릅니다.

> **상태: 결정됨 (2026-11-05).** 보류였던 2건은 법령 원문(국가법령정보센터)을 확인해 정했습니다.

## 요약

| 영역 | 규칙 | 질문 | 따름 | 바꿈 | 보류 |
|---|---|---:|---:|---:|---:|
| 신고 건 | [filing-status-transitions](#filing-status-transitions) | 8 | 2 | 6 | 0 |
| 신고 건 | [filing-requirements](#filing-requirements) | 6 | 5 | 1 | 0 |
| 신고 건 | [filing-progress](#filing-progress) | 5 | 3 | 2 | 0 |
| 세무 일정 | [filing-deadline-rollover](#filing-deadline-rollover) | 3 | 3 | 0 | 0 |
| 세무 일정 | [filing-obligations](#filing-obligations) | 6 | 4 | 2 | 0 |
| 할 일 | [action-card-lifecycle](#action-card-lifecycle) | 6 | 4 | 2 | 0 |
| 예상 부가세 | [estimated-vat](#estimated-vat) | 7 | 4 | 3 | 0 |
| | **합계** | **41** | **25** | **16** | **0** |

## filing-status-transitions

규칙: [filing-status-transitions.md](../../reference/rules/filing-status-transitions.md)

| # | 질문 | 결정 | 근거 |
|---|---|---|---|
| 1 | 고객 커맨드를 대리인이 대신 보낼 수 없게 행위자를 엄격히 나눌까요 | **따름, 원천세는 대행(2026-11-07):** 커맨드마다 차례인 행위자 하나입니다. 원천세의 `:submit`·`:unsubmit`·`:pay`만 배정된 대리인이 대신 보낼 수 있고, 이력에 대리인과 `onBehalfOf: CLIENT`가 남습니다. 별도 커맨드 대신 전이 규칙의 대행 세목(`agencyProxyTaxTypes`)으로 둡니다 | 매뉴얼의 "고객 확인" 단계(매입매출장 확인, 납부)는 고객의 의사 표시라 대리인이 대신하면 의미가 사라집니다. 원천세는 대리인이 고객 대신 자료를 내고 납부를 기록하는 업무가 있어 제품 결정으로 열었습니다. 원천세 `:pay`는 고객의 승인이 아니라 이미 한 납부(`paidOn`)를 기록하는 일이고, 원천세는 대리인이 납부서를 만들고 납부 여부를 확인하는 경우가 많아 예외로 둡니다. 부가세 등의 납부와 매입매출장 확인은 그대로 고객의 의사 표시로 남깁니다. 현행은 이를 고객으로 기록했지만, 새로는 실제로 한 사람을 남깁니다([tax.md](../tax.md#커맨드)) |
| 2 | 매입매출장 교체를 업로드 커맨드 하나로 합칠까요 | **바꿈:** `:upload-ledger`가 `REVIEWING`과 `LEDGER_PENDING`을 모두 받습니다. `LEDGER_PENDING`에서는 상태를 유지한 채 문서를 바꾸고 확인 시각을 지웁니다 | 전이표에 드러나야 `allowedActions`로 버튼을 켤 수 있습니다 ([커맨드](../tax.md#커맨드)) |
| 3 | 예정고지 건의 자료 요청·검토 흐름을 막을까요 | **바꿈:** `kind: NOTICE`는 `:record-notice`, `:cancel`, `:pay`, `:close`만 받습니다 | 고지서로 끝나는 건이라 자료 제출 단계가 없습니다 |
| 4 | `submitted`에서 취소할 수 있게 할까요 | **바꿈:** `SUBMITTED`도 `:cancel`을 받습니다 | 고객이 낸 뒤 의무가 사라지면 대리인이 검토를 거치지 않고 정리해야 합니다. 검토 시작 뒤(`REVIEWING`)는 여전히 받지 않습니다 |
| 5 | 신고서 업로드와 신고 완료를 한 커맨드로 합칠까요 | **바꿈:** `:file { payableAmount, returnFileId, paymentSlipFileId? }`가 문서를 붙이고 `FILED`로 바꾸는 일을 한 트랜잭션에서 합니다. 신고서 없는 요청은 400입니다 | [원칙 2](../README.md#설계-원칙) 업무 하나 = 요청 하나 |
| 6 | `If-Match`를 필수(없으면 428)로 둘까요 | **바꿈:** 선택입니다. 있으면 다를 때 412 | [동시성](../conventions.md#동시성) 규약을 따릅니다 |
| 7 | 행위자 불일치를 `PERMISSION_DENIED`로 돌려줄까요 | **바꿈:** 403 `FILING_ACTOR_NOT_ALLOWED`(`action`, `requiredActorKind`)로 나눕니다 | 화면이 "권한 없음"과 "상대방 차례"를 다르게 안내해야 합니다 |
| 8 | 기한이 지나도 자료 제출을 받고 `is_overdue`만 표시할까요 | **따름** | 기한 후 신고도 업무상 흔하고, 막으면 대리인이 처리할 길이 없어집니다 |

**바뀌는 케이스**

- `request materials for a notice filing`: 성공 → 409 `FILING_TRANSITION_INVALID` (질문 3)
- `cancel submitted`: 거절 → `CANCELED` (질문 4)
- 오류 코드: `PERMISSION_DENIED` → `FILING_ACTOR_NOT_ALLOWED`, `INVALID_TRANSITION` → `FILING_TRANSITION_INVALID`, `VALIDATION_FAILED`(남은 항목) → `FILING_REQUIREMENTS_PENDING` (질문 7)
- D5(2026-11-06) 뒤에도 질문 7의 결정을 유지합니다. `filing:process`가 대리인 전용이 되어 고객 관리자의 `*`로는 통과하지 못하지만, 신고 건을 볼 수 있는(`filing:read`) 고객이 대리인 커맨드나 문서 붙이기를 부르면 권한 단계에서 같은 403 `FILING_ACTOR_NOT_ALLOWED`(`requiredActorKind: AGENCY`)로 돌려줍니다. 대리인 전용 권한 말고 다른 요건이 막히면 D5 전과 같은 오류를 같은 순서로 줍니다. 플랜이 없으면 `ENTITLEMENT_REQUIRED`, 세무 약관 재동의 전이면 `TERMS_REAGREEMENT_REQUIRED`, 데모 계정이면 `PERMISSION_DENIED`입니다. 달라진 점은 순서뿐입니다. 이 경우 신고 건 없음(404)·`If-Match` 불일치(412)·상태 불일치(409)보다 이 오류가 먼저입니다
- `file without a return document`: 옮기지 않음. 스키마가 `returnFileId`를 요구합니다 (질문 5)

## filing-requirements

규칙: [filing-requirements.md](../../reference/rules/filing-requirements.md)

| # | 질문 | 결정 | 근거 |
|---|---|---|---|
| 1 | 법인세·종합소득세에 체크리스트가 없는 것을 따를까요 | **따름:** 지금은 없습니다. 템플릿은 세목·종류별 표라 항목이 정해지면 데이터만 더합니다 | 현행 매뉴얼에도 해당 세목의 제출 항목이 없습니다 ([열린 질문](../tax.md#열린-질문) 6) |
| 2 | 항목 라벨을 서버가 내려주는 것을 코드만 주도록 바꿀까요 | **바꿈:** `code`(`PG_ONLINE_SALES` …)만 줍니다 | [필드와 값](../conventions.md#필드와-값): 화면 문자열은 클라이언트 i18n |
| 3 | 파일이 붙은 항목에 `pending`을 고르면 `provided`로 남길까요 | **따름** | 파일이 있는데 `PENDING`이면 제출 검사가 실제와 어긋납니다 |
| 4 | 기간에 지급한 급여대장이 없으면 `pending`으로 둘까요 | **따름** | 급여가 없는 달을 자동으로 "제출됨"으로 보면 대리인이 확인할 기회가 없습니다. 고객 제출은 막지 않습니다(질문 5) |
| 5 | 자동 연계 항목을 제출 검사에서 뺄까요 | **따름** | 고객이 고칠 수 없는 항목으로 고객 제출을 막으면 안 됩니다 |
| 6 | 항목 응답·파일 첨부에 `If-Match`를 받지 않을까요 | **따름:** 상태(`REQUESTED`)로만 잠그고 `version`은 올립니다 | 고객이 항목을 하나씩 채우는 동안 버전을 맞추게 하면 화면만 번거롭습니다 |

**바뀌는 케이스:** 없음. 값 이름만 SCREAMING enum으로 바뀝니다.

## filing-progress

규칙: [filing-progress.md](../../reference/rules/filing-progress.md)

| # | 질문 | 결정 | 근거 |
|---|---|---|---|
| 1 | 단계 이름을 enum 코드로 바꿀까요 | **바꿈:** `progress { stage, index, count }`, `stage`는 `MATERIALS_OPEN`·`UNDER_REVIEW`·`LEDGER_CONFIRMATION`·`PREPARING`·`PAYMENT`·`CLOSED` | 화면 문구는 클라이언트가 고릅니다 |
| 2 | 부가세 외 세목의 단계 구성(5단계)을 따를까요 | **따름:** 단계 구성과 위치는 같고 이름만 enum입니다 | 부가세와 매입매출장 확인 단계만 다릅니다 |
| 3 | `submitted`와 `reviewing`을 한 단계로 묶을까요 | **따름** | 진행 막대용 단계이고, 둘의 차이는 `status`로 볼 수 있습니다 |
| 4 | 진행 현황을 별도 엔드포인트로 둘까요 | **바꿈:** `GET /filings?open=true`의 `progress`를 씁니다 | 같은 데이터를 두 경로로 주지 않습니다 |
| 5 | 신고 기한이 없으면 납부 기한, 기한 당일은 경과 아님을 따를까요 | **따름** | 예정고지 건도 기한 경과를 보여야 합니다 |

**바뀌는 케이스:** 단계 이름(`자료 제출 가능` → `MATERIALS_OPEN` …)과 `/home/tracker` 응답 형태.

## filing-deadline-rollover

규칙: [filing-deadline-rollover.md](../../reference/rules/filing-deadline-rollover.md)

| # | 질문 | 결정 | 근거 |
|---|---|---|---|
| 1 | 공휴일 표를 누가 관리하고, 근로자의 날을 넣을까요 | **따름:** Tax의 `PublicHolidays` 포트가 표를 읽고, 운영이 대체·임시공휴일과 근로자의 날을 넣습니다. 표가 바뀌면 일정 배치를 돌립니다 | 국세기본법 제5조가 근로자의 날을 기한 연장일로 정합니다 |
| 2 | 다시 계산하는 범위를 `scheduled`·`requested`로 둘까요 | **따름** | 고객이 낸 뒤 기한이 바뀌면 대리인 일정이 흔들립니다 |
| 3 | 납부 기한을 신고 기한과 같은 날로 둘까요 | **따름:** 일정의 `paymentDue`는 신고 기한과 같습니다. 분납은 납세자가 고르는 것이라 `:file`의 `paymentDue`로 신고 건마다 덮어씁니다 | 신고와 함께 납부합니다: [부가가치세법 제48조 ②·제49조 ②](https://www.law.go.kr/법령/부가가치세법), [법인세법 제64조 ①](https://www.law.go.kr/법령/법인세법), [소득세법 제76조 ①·제128조 ①](https://www.law.go.kr/법령/소득세법). 분납은 1천만원 초과분을 1개월(중소기업 2개월, 개인 2개월) 안에 나눠 냅니다(법인세법 제64조 ②, 소득세법 제77조) |

**바뀌는 케이스:** 없음.

## filing-obligations

규칙: [filing-obligations.md](../../reference/rules/filing-obligations.md)

| # | 질문 | 결정 | 근거 |
|---|---|---|---|
| 1 | `year`/`quarter` 필드를 계속 둘까요 | **바꿈:** `periodKey`(`2026-H2`, `2026-10`, `2026`)와 `periodStart`·`periodEnd`만 둡니다 | 반기 건의 `quarter` 2·4는 추정 값이라 뜻이 없습니다 |
| 2 | 개인은 설정과 상관없이 예정고지로 둘까요 | **따름** | 개인 일반과세자는 예정고지가 원칙입니다 |
| 3 | 예정고지 건의 납부 기한을 미리 채울까요 | **따름:** 법정 25일(이월 적용)로 채우고, `:record-notice`가 고지서 기한으로 덮어씁니다 | 일정·카드가 고지서 도착 전에도 기한을 보여야 합니다 |
| 4 | 간이과세자·중간예납·연말정산을 일정에 넣을까요 | **바꿈:** 중간예납과 간이과세자를 넣고, 연말정산은 따로 넣지 않습니다. 법인 중간예납은 새 종류 `INTERIM`(사업연도 첫 6개월, 그 뒤 2개월 말일), 개인 중간예납은 `INCOME_TAX`의 `NOTICE`(1–6월, 11월 30일)입니다. 간이과세자(프로필 `vatTaxpayerType: SIMPLIFIED`, 개인만)는 예정부과 `NOTICE`(1–6월, 7월 25일)와 1년 `FINAL`(다음 해 1월 25일)입니다. 예정부과기간에 세금계산서를 발급했으면(프로필 `vatSimplifiedInvoiceIssuer`, 기본 거짓) 고지 대신 `PRELIMINARY` 신고입니다(제66조 ③). 의무가 없는 경우(법인: 신설 첫 사업연도, 사업연도 6개월 이하, 직전 사업연도 중소기업으로서 계산액 50만원 미만. 개인·부가세: 50만원 미만 등)는 프로필이 모르므로 대리인이 취소합니다. 과세 유형이 바뀐 해(제5조 ④, 제66조 ① 2호)와 복식부기의무자의 중간예납추계액 신고(소득세법 제65조 ⑤)는 아직 계산하지 않습니다([열린 질문](../tax.md#열린-질문) 6) | [법인세법 제63조 ①(50만원 기준은 2호의 중소기업만)·②·③](https://www.law.go.kr/법령/법인세법), [소득세법 제65조 ①·제86조](https://www.law.go.kr/법령/소득세법), [부가가치세법 제5조 ①·제66조 ①·③·제67조 ①](https://www.law.go.kr/법령/부가가치세법). 연말정산은 2월분 근로소득 지급 때 원천징수하므로 2월분 원천세(3월 10일)에 들어갑니다([소득세법 제137조 ①](https://www.law.go.kr/법령/소득세법)) |
| 5 | 취소한 신고 건을 다시 만들지 않을까요 | **따름** | 대리인이 일부러 취소한 건을 배치가 되살리면 안 됩니다 |
| 6 | 해당 없는 `scheduled`만 자동 취소할까요 | **따름** | `requested` 이후는 고객·대리인이 이미 손을 댄 건입니다 |

**바뀌는 케이스:** 출력 필드(`year`, `quarter`, `taxPeriodKey`) → `periodKey`, 세목 이름(`surtax` → `VAT` …). 질문 4로 새 의무가 생기지만 픽스처 창(법인 11월·1월)에는 들지 않아 기대값은 그대로이고, `filing-obligations.test.ts`가 따로 확인합니다. 회사 세무 설정 저장소가 없어 프로필의 과세 유형은 지금 `GENERAL`입니다.

## action-card-lifecycle

규칙: [action-card-lifecycle.md](../../reference/rules/action-card-lifecycle.md)

| # | 질문 | 결정 | 근거 |
|---|---|---|---|
| 1 | 카드 제목과 바로가기 경로를 서버가 만들까요 | **바꿈:** `kind`와 `subject { type: FILING, filingId, taxType, filingKind, periodKey }`만 줍니다 | 문구와 화면 경로는 클라이언트 몫입니다 |
| 2 | 매입매출장 확인 마감일을 신고 기한 − 3일로 둘까요 | **따름** | 영업일 보정은 고객 안내용 마감일이라 필요하지 않습니다 |
| 3 | `done`은 마감일이 지나도 `done`일까요 | **따름** | 사용자가 실제로 끝낸 일을 경과로 표시하면 오해를 부릅니다. 매뉴얼 문구를 고칩니다 |
| 4 | 결과 확인 카드를 신고서·고지서 열람으로만 닫을까요 | **따름** | 납부서는 납부 카드의 일입니다 |
| 5 | 메뉴 코드 판정을 권한·플랜으로 바꿀까요 | **바꿈:** 카드마다 `requires { permission, plans }`를 저장하고 행위자로 거릅니다. 신고 건 카드는 `filing:read` + `TAXATION` | 메뉴 트리는 화면 구성이고 접근 판정이 아닙니다 ([P5](../README.md#현행-구조의-핵심-문제)) |
| 6 | 세무 밖 카드도 같은 저장소에 둘까요 | **따름:** 같은 저장소에 `subject.type`으로 구분합니다. 다른 컨텍스트가 열려면 공개 포트를 냅니다 | 홈 목록·개수가 한 곳에서 나와야 합니다 |

**바뀌는 케이스**

- 응답 필드: `title`, `cta_path`, `menu_code`, `source_type`, `source_id` → `kind`, `subject` (질문 1)
- `card of a menu the user cannot open is hidden`, `card of an accessible menu is shown`: 옮기지 않음. 권한·플랜 판정은 HTTP 테스트가 봅니다 (질문 5)
- `complete a closed card`: 옮기지 않음. 서비스가 409 `ACTION_CARD_CLOSED`로 처리하고 HTTP 테스트가 봅니다

## estimated-vat

규칙: [estimated-vat.md](../../reference/rules/estimated-vat.md)

| # | 질문 | 결정 | 근거 |
|---|---|---|---|
| 1 | 몰·배달 매출을 합계에서 빼고 내역에만 보여 줄까요 | **따름** | PG와 겹치면 두 번 셉니다. `dedupeGroup`이 채워지면 다시 봅니다 |
| 2 | 미분류 매입을 합계에서 뺄까요 | **따름:** 빼고 `excluded.unclassifiedCount`로 알립니다 | 예상 세액이 낮게 나와 납부액을 놓치는 쪽보다 높게 나오는 쪽이 안전합니다 |
| 3 | 카드 과세 비율을 bp에서 ppm으로 바꿀까요 | **바꿈:** `taxableCardRatioPpm` | [필드와 값](../conventions.md#필드와-값) 요율 규약 |
| 4 | 추이의 확정 세액에서 예정고지 금액을 뺄까요 | **따름** | 고지 세액은 확정 신고에서 다시 정산되므로 더하면 두 번 셉니다 |
| 5 | 법인 예상은 분기, 추이는 반기인 것을 따를까요 | **따름** | 신고 주기(예정·확정)와 과세기간이 다릅니다. 응답의 `period.unit`으로 드러냅니다 |
| 6 | `is_refund`를 둘까요 | **바꿈:** 두지 않습니다. `estimatedTax < 0`이면 환급입니다 | 부호로 알 수 있는 값을 따로 두지 않습니다 |
| 7 | 출처별 `last_scrap_status`를 계속 넣을까요 | **바꿈:** 넣지 않고 `lastSyncedAt`만 둡니다 | 수집 작업 상태는 Integrations의 수집 요청 리소스입니다 |

**바뀌는 케이스**

- 입력 `taxableCardRatioBp` → `taxableCardRatioPpm` (× 100) (질문 3)
- 응답 `is_refund` → `estimatedTax < 0` (질문 6)

## 구현 상태

| 규칙 | 구현 | 픽스처 테스트 | 옮기지 않은 케이스 |
|---|---|---|---|
| [filing-status-transitions](#filing-status-transitions) | [filing-status.ts](../../../apps/api/src/modules/tax/filings/filing-status.ts), [filings.ts](../../../apps/api/src/modules/tax/filings/filings.ts) | [filing-status.fixtures.test.ts](../../../apps/api/src/modules/tax/filings/filing-status.fixtures.test.ts) | 신고서 없는 `file` 1건 |
| [filing-requirements](#filing-requirements) | [filing-requirements.ts](../../../apps/api/src/modules/tax/filings/filing-requirements.ts) | [filing-requirements.fixtures.test.ts](../../../apps/api/src/modules/tax/filings/filing-requirements.fixtures.test.ts) | 없음 |
| [filing-progress](#filing-progress) | [filing-progress.ts](../../../apps/api/src/modules/tax/filings/filing-progress.ts) | [filing-progress.fixtures.test.ts](../../../apps/api/src/modules/tax/filings/filing-progress.fixtures.test.ts) | 없음 |
| [filing-deadline-rollover](#filing-deadline-rollover) | [filing-deadline.ts](../../../apps/api/src/modules/tax/calendar/filing-deadline.ts) | [filing-calendar.fixtures.test.ts](../../../apps/api/src/modules/tax/calendar/filing-calendar.fixtures.test.ts) | 없음 |
| [filing-obligations](#filing-obligations) | [filing-obligations.ts](../../../apps/api/src/modules/tax/calendar/filing-obligations.ts), [filing-schedule.ts](../../../apps/api/src/modules/tax/calendar/filing-schedule.ts) | [filing-calendar.fixtures.test.ts](../../../apps/api/src/modules/tax/calendar/filing-calendar.fixtures.test.ts) | 없음 |
| [action-card-lifecycle](#action-card-lifecycle) | [action-card-rules.ts](../../../apps/api/src/modules/tax/action-cards/action-card-rules.ts), [action-cards.ts](../../../apps/api/src/modules/tax/action-cards/action-cards.ts) | [action-card-rules.fixtures.test.ts](../../../apps/api/src/modules/tax/action-cards/action-card-rules.fixtures.test.ts) | 메뉴 판정 2건, 닫힌 카드 완료 1건 |
| [estimated-vat](#estimated-vat) | [vat-estimate.ts](../../../apps/api/src/modules/tax/vat-estimates/vat-estimate.ts) | [vat-estimate.fixtures.test.ts](../../../apps/api/src/modules/tax/vat-estimates/vat-estimate.fixtures.test.ts) | 없음 |
