# 규칙 결정: Bookkeeping

경리 규칙 14개의 열린 질문 29개에 대한 서버 결정입니다. 근거 자료는 [규칙 문서](../../reference/rules/README.md), 픽스처(`apps/api/test/fixtures/rules/`), [Bookkeeping 설계](../bookkeeping.md)입니다. 픽스처는 `apps/api/src/modules/bookkeeping/bookkeeping-rules.fixtures.test.ts`가 재설계 순수 함수로 돌리고, 바뀌는 케이스는 그 파일의 `CHANGED`에 결정 번호와 함께 있습니다.

> **상태: 결정됨 (가정 포함, 2026-11-05).** 따름 12, 바꿈 12, 보류 5입니다. 바뀌는 케이스는 5개이고 모두 `CHANGED`로 테스트합니다.

## 요약

| 영역 | 규칙 | 질문 | 따름 | 바꿈 | 보류 |
|---|---|---:|---:|---:|---:|
| 분류 | [classification-rule-matching](#classification-rule-matching) | 2 | 1 | 1 | 0 |
| 분류 | [classification-apply-mode](#classification-apply-mode) | 1 | 1 | 0 | 0 |
| 분류 | [account-title-constraints](#account-title-constraints) | 2 | 1 | 0 | 1 |
| 입출금 | [settlement-match-status](#settlement-match-status) | 3 | 0 | 3 | 0 |
| 입출금 | [bank-balance-snapshot](#bank-balance-snapshot) | 2 | 1 | 0 | 1 |
| 거래처 | [partner-outstanding-amount](#partner-outstanding-amount) | 2 | 1 | 1 | 0 |
| 거래처 | [business-status-cache](#business-status-cache) | 2 | 1 | 1 | 0 |
| 실시간 보고서 | [realtime-pl-inclusion](#realtime-pl-inclusion) | 2 | 1 | 0 | 1 |
| 실시간 보고서 | [cash-status-other-change](#cash-status-other-change) | 1 | 0 | 0 | 1 |
| 실시간 보고서 | [vat-due-date-approximation](#vat-due-date-approximation) | 2 | 1 | 1 | 0 |
| 수집·증빙 | [scraped-record-ingestion](#scraped-record-ingestion) | 3 | 1 | 2 | 0 |
| 수집·증빙 | [evidence-amounts](#evidence-amounts) | 2 | 1 | 1 | 0 |
| 발급·납부 | [sales-statement-totals](#sales-statement-totals) | 3 | 0 | 2 | 1 |
| 발급·납부 | [giro-status-transitions](#giro-status-transitions) | 2 | 2 | 0 | 0 |
| | **합계** | **29** | **12** | **12** | **5** |

## 결정 기록

코드만으로 답이 나오지 않는 질문입니다. 모두 권장안을 채택했습니다(2026-11-05).

#### classification-apply-mode 1: `OVERWRITE`가 사람이 고친 분류를 덮는지 · 채택

- **결정:** 덮지 않습니다. `OVERWRITE`도 `classification.method = MANUAL`인 행은 건너뜁니다(`OVERWRITE_KEEPS_MANUAL = true`)
- **검토한 대안:** 매뉴얼 문구대로 모든 행을 덮기 / 적용 요청에 `includeManual` 옵션
- **선택 이유:** 규칙 하나를 고쳐 다시 돌릴 때 사람이 하나씩 고친 분류가 말없이 사라지면 되돌릴 방법이 없습니다. 현행 서버도 건너뜁니다
- **가정과 되돌릴 조건:** 사용자가 "덮어쓰기"를 "규칙이 매긴 것을 다시 매기기"로 이해한다고 가정합니다. 수동 분류까지 덮기를 바라는 요청이 있으면 옵션을 붙이고 상수는 기본값으로 남깁니다

#### business-status-cache 1: 캐시 날짜의 시간대 · 채택

- **결정:** 조회 시각을 회사 시간대 날짜로 바꿔 비교합니다
- **검토한 대안:** 현행처럼 UTC 날짜(`slice(0, 10)`) / 24시간 TTL
- **선택 이유:** "하루 캐시"는 사용자 기준 하루입니다. UTC로 자르면 한국 0~9시 조회가 전날 조회가 됩니다
- **가정과 되돌릴 조건:** 국세청 상태가 하루 안에 바뀌는 일은 드물다고 가정합니다. 실시간성이 필요하면 강제 새로고침 파라미터를 붙입니다

#### scraped-record-ingestion 2: 잘못된 레코드 처리 · 채택

- **결정:** 그 레코드만 거절하고 `rejected[{ index, reason }]`으로 알립니다. 나머지는 반영합니다
- **검토한 대안:** 현행처럼 DB 제약 오류로 묶음 전체 되돌리기 / 잘못된 값을 고쳐 받기(금액 0 등)
- **선택 이유:** 수집은 은행·카드·홈택스가 섞인 큰 묶음입니다. 한 건 때문에 계좌 잔액까지 안 들어오면 화면 전체가 멈춥니다. 고쳐 받으면 틀린 숫자가 보고서에 들어갑니다
- **가정과 되돌릴 조건:** Integrations가 거절 목록을 보고 재수집하거나 경보를 낸다고 가정합니다

#### vat-due-date-approximation 1: 홈 부가세 기한 · 채택

- **결정:** 기한은 Tax의 `VatEstimateSource.current`가 준 `dueDate`를 씁니다. 근사(다음 달 25일)는 가짜 구현에만 남깁니다
- **검토한 대안:** 근사 유지 / Bookkeeping이 공휴일 달력 보유
- **선택 이유:** 세무 일정은 Tax가 소유합니다. 휴일 기한을 보여 주면 사용자가 하루 일찍 서두르거나 세무 일정 화면과 날짜가 달라집니다
- **가정과 되돌릴 조건:** Tax가 주말·공휴일을 반영한 기한을 준다고 가정합니다

#### sales-statement-totals 2: 발급 중 잠금 · 채택

- **결정:** 홈택스 응답을 기다리는 동안 명세서를 `ISSUING`으로 잠가 수정·삭제·재발급을 409로 막습니다
- **검토한 대안:** 현행처럼 잠금 없음(동기 120초 대기 중 다른 요청 허용)
- **선택 이유:** 발급 중 금액이 바뀌면 홈택스에 간 명세서와 저장된 명세서가 달라집니다. 같은 명세서를 두 번 발급하면 이중 세금계산서가 됩니다
- **가정과 되돌릴 조건:** 홈택스 응답이 오지 않고 끊기면 `ISSUING`이 남습니다. 발급을 Job으로 바꿀 때 시간 초과 → `FAILED` 전이를 붙입니다

## 분류

### classification-rule-matching

[규칙 문서](../../reference/rules/classification-rule-matching.md) · 케이스 12 · 질문 2

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | 첫 위반 하나만 문장으로 돌려주는 것을 바꿀까요 | **바꿈:** 422 `CLASSIFICATION_RULE_INVALID { violations[{ index, code }] }`로 모두 돌려줍니다 | 화면이 조건 줄마다 오류를 보일 수 있습니다. 단일 위반 케이스는 결과가 같아 픽스처가 그대로 통과합니다 |
| 2 | 매입 규칙의 `source`로 PG·쇼핑몰·배달을 받을까요 | **따름:** 매입 원천(세금계산서·현금영수증·카드)만 받습니다 | 현행 `purchase_evidence.source CHECK`가 세 원천만 허용해 매입 PG 증빙이 존재하지 않습니다 |

**바뀌는 케이스:** 없음

### classification-apply-mode

[규칙 문서](../../reference/rules/classification-apply-mode.md) · 케이스 7 · 질문 1

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | `OVERWRITE`가 사람이 고친 분류를 덮을까요 | **따름:** 덮지 않습니다 | [결정 기록](#classification-apply-mode-1-overwrite가-사람이-고친-분류를-덮는지--채택) |

**바뀌는 케이스:** 없음

### account-title-constraints

[규칙 문서](../../reference/rules/account-title-constraints.md) · 케이스 16 · 질문 2

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | 삭제할 계정의 거래를 옮길 계정이 적용 범위에 맞는지 볼까요 | **따름:** 선택 가능 여부만 봅니다 | 계정 하나에 매출·매입·입출금이 섞여 있을 수 있어 범위 하나로 판정할 수 없습니다. 맞지 않는 범위로 옮겨진 행은 분류 화면에서 다시 고칩니다 |
| 2 | 기본 계정 54행이 현행 서비스 체계와 같은가요 | **보류:** 현행 마이그레이션의 추정 체계를 그대로 씁니다 | 실제 체계는 현행 화면 전수 확인이 필요합니다. ID가 정렬 순서로 고정이라 행을 고치면 시드·규칙 데이터 이전이 필요합니다. 법령·고시가 아니라 현행 서비스 데이터라 공개 원문으로 확인할 수 없습니다. 남은 것: 현행 화면 전수 확인 |

**바뀌는 케이스:** 없음

## 입출금

### settlement-match-status

[규칙 문서](../../reference/rules/settlement-match-status.md) · 케이스 10 · 질문 3

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | 증빙 연결 상태를 저장할까요 | **바꿈:** 읽을 때 계산합니다 | 저장하면 분류·거래처·연결이 바뀔 때마다 다시 계산해야 합니다. 판정 함수는 같아 케이스 결과는 같습니다 |
| 2 | 연결을 증빙별 upsert와 따로 해제로 둘까요 | **바꿈:** `:link`가 거래의 연결 전체를 바꿉니다(빈 배열 = 해제) | 부분 갱신은 거래 합계 검사를 어렵게 합니다. 한 번에 바꾸면 `EXCEEDS_TRANSACTION`을 한 번에 판정합니다 |
| 3 | 금액 0 이하 연결을 막을까요 | **바꿈:** `AMOUNT_NOT_POSITIVE`로 막습니다 | 현행은 스키마 검사에 맡겨 확인하지 못했습니다. 0원 연결은 상태 판정을 흐립니다 |

**바뀌는 케이스:** 없음

### bank-balance-snapshot

[규칙 문서](../../reference/rules/bank-balance-snapshot.md) · 케이스 9 · 질문 2

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | 같은 분 거래의 순서를 수집 키 역순으로 정해도 될까요 | **보류:** 현행대로 수집 키 역순 | 은행별 수집 키 형식을 Integrations에서 확인해야 합니다. 법령·고시가 아니라 수집 업체 동작이라 공개 원문으로 확인할 수 없습니다. 남은 것: 은행별 수집 키 형식 |
| 2 | 오프셋이 섞인 시각을 비교할까요 | **따름:** 문자열 비교를 유지하고, 수집 계약에서 회사 시간대 오프셋을 요구합니다 | 정규화는 Integrations 쪽 한 곳에서 하는 것이 맞습니다 |

**바뀌는 케이스:** 없음

## 거래처

### partner-outstanding-amount

[규칙 문서](../../reference/rules/partner-outstanding-amount.md) · 케이스 4 · 질문 2

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | 매출 증빙 합계가 비어 있을 때 어떻게 셀까요 | **바꿈:** 양쪽 모두 `evidence-amounts`의 합계를 씁니다 | 재설계는 공급가액·세액만 온 매출 증빙을 받습니다. 현행은 매출 합계가 `NOT NULL`이라 같은 상황이 없어 케이스 결과는 같습니다 |
| 2 | 실시간 미정산과 결산 미수·미지급을 어떻게 구분할까요 | **따름:** 두 숫자를 따로 둡니다. 실시간은 거래처 응답의 `outstanding`, 결산은 Tax 보고서 | 스펙이 "다른 숫자"라고 못박았습니다 |

**바뀌는 케이스:** 없음

### business-status-cache

[규칙 문서](../../reference/rules/business-status-cache.md) · 케이스 4 · 질문 2

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | 캐시 날짜를 UTC로 자를까요 | **바꿈:** 회사 시간대 날짜 | [결정 기록](#business-status-cache-1-캐시-날짜의-시간대--채택) |
| 2 | 조회가 거래처 `businessStatus`도 고칠까요 | **따름:** 고칩니다. 아직 구현하지 않았습니다 | 거래처 목록의 휴·폐업 표시가 조회 결과와 어긋나지 않게 합니다 |

**바뀌는 케이스:**
- `an early morning lookup stored in UTC`: `false` → `true` (KST 01:00 조회는 같은 날)

## 실시간 보고서

### realtime-pl-inclusion

[규칙 문서](../../reference/rules/realtime-pl-inclusion.md) · 케이스 7 · 질문 2

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | 회사별 손익 정책(공급가액/합계, 입출금 포함)을 바꾸게 할까요 | **보류:** 기본값(공급가액, 포함)만 씁니다 | 현행은 설정을 읽지만 바꾸는 화면이 없습니다. 노출할지는 제품 결정입니다. 외부 사실이 아니라 제품 결정입니다 |
| 2 | 증빙 있는 비용을 입출금으로도 손익 계정에 분류하면 막을까요 | **따름:** 막지 않습니다 | 거래대금 계정을 쓰라는 안내로 충분하고, 막으면 증빙 없는 지출(급여 등)과 구분할 수 없습니다 |

**바뀌는 케이스:** 없음

### cash-status-other-change

[규칙 문서](../../reference/rules/cash-status-other-change.md) · 케이스 4 · 질문 1

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | 외화 계좌 잔액을 원화로 바꿀까요 | **보류:** 현행대로 그대로 더합니다 | 환율 출처(수집 시점 환율, 고시 환율)를 정해야 합니다. 외부 사실이 아니라 제품 결정(환율 출처 선택)입니다. 남은 것: 수집 시점 환율과 고시 환율 중 선택 |

**바뀌는 케이스:** 없음

### vat-due-date-approximation

[규칙 문서](../../reference/rules/vat-due-date-approximation.md) · 케이스 4 · 질문 2

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | 주말·공휴일을 보정하지 않는 근사를 쓸까요 | **바꿈:** Tax 세무 일정의 기한 | [결정 기록](#vat-due-date-approximation-1-홈-부가세-기한--채택) |
| 2 | 예정 고지 대상 개인사업자의 4·10월 납부를 넣을까요 | **따름:** 홈 예상 부가세 카드에는 넣지 않습니다. 4·10월 예정고지는 Tax 세무 일정의 `NOTICE` 신고 건(25일, 이월 적용)으로 보입니다 | 예정고지 금액은 이번 기간 예상 세액이 아니라 직전 과세기간 납부세액의 50%이고 50만원 미만이면 징수하지 않으며, 확정 신고 때 빼고 냅니다([부가가치세법 제48조 ③·제49조 ② 2호](https://www.law.go.kr/법령/부가가치세법)) |

**바뀌는 케이스:** 없음. 근사 함수는 남아 케이스를 그대로 통과합니다. 홈 요약의 기한은 포트 값으로 바뀝니다

## 수집·증빙

### scraped-record-ingestion

[규칙 문서](../../reference/rules/scraped-record-ingestion.md) · 케이스 9 · 질문 3

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | 카드 승인 날짜를 UTC로 자를까요 | **바꿈:** 회사 시간대 날짜 | 승인 시각이 UTC로 오면 새벽 결제가 전날 증빙이 됩니다 |
| 2 | 금액 없음·매입 PG·빈 수집 키를 어떻게 처리할까요 | **바꿈:** 그 레코드만 거절 | [결정 기록](#scraped-record-ingestion-2-잘못된-레코드-처리--채택) |
| 3 | 카드 승인 세액이 없으면 0으로 둘까요 | **따름:** 0으로 둡니다 | 간이·면세 가맹점을 가릴 근거가 수집 데이터에 없습니다. 나눠 내면 면세 가맹점 공제가 과대해집니다 |

**바뀌는 케이스:**
- `a card approval stamped in UTC`: `writtenOn` `2026-10-13` → `2026-10-14`
- `evidence without amounts`: 묶음 전체 실패 → `AMOUNTS_MISSING`
- `PG evidence sent as purchase`: 묶음 전체 실패 → `SOURCE_SIDE_MISMATCH`
- `evidence with a blank external key`: 받음 → `EXTERNAL_KEY_MISSING`

### evidence-amounts

[규칙 문서](../../reference/rules/evidence-amounts.md) · 케이스 8 · 질문 2

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | 서로 맞지 않는 세 금액을 고칠까요 | **따름:** 받은 값을 그대로 둡니다 | 어느 값이 틀렸는지 알 수 없습니다. 원천 값을 보존해야 Tax가 신고 대사를 할 수 있습니다 |
| 2 | 합계에서 나눈 세액을 표시할까요 | **바꿈:** `vatEstimated`를 응답에 둡니다 | 값은 같고 표시만 늘어 케이스 결과는 같습니다 |

**바뀌는 케이스:** 없음

## 발급·납부

### sales-statement-totals

[규칙 문서](../../reference/rules/sales-statement-totals.md) · 케이스 10 · 질문 3

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | 첫 문제 하나만 던질까요 | **바꿈:** 422 `SALES_STATEMENT_INVALID { problems }`로 모두 | 입력 화면이 여러 칸을 한 번에 표시할 수 있습니다 |
| 2 | 발급 중 상태를 둘까요 | **바꿈:** `ISSUING`으로 잠급니다 | [결정 기록](#sales-statement-totals-2-발급-중-잠금--채택) |
| 3 | 수정 발행·위수탁을 언제 지원할까요 | **보류:** 받지 않습니다 | 수정 사유별 홈택스 규칙과 Integrations 지원이 먼저입니다. 확인한 것: 발급 사유와 절차는 [부가가치세법 시행령 제70조](https://www.law.go.kr/법령/부가가치세법시행령)에 있습니다. 남은 것: 홈택스 발급 어댑터의 수정·위수탁 지원(외부 서비스)과 지원 시점(제품 결정) |

**바뀌는 케이스:** 없음

### giro-status-transitions

[규칙 문서](../../reference/rules/giro-status-transitions.md) · 케이스 13 · 질문 2

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | 숨긴 고지서를 되돌리는 커맨드를 둘까요 | **따름:** 두지 않습니다 | 현행 화면에 되돌리기가 없고, 숨긴 고지서는 재수집에도 그대로입니다 |
| 2 | `UNKNOWN` 고지서를 앱에서 납부하게 할까요 | **따름:** 막습니다 | 목록에서 사라진 고지서는 기한 초과·취소일 수 있어 출금하면 환불이 어렵습니다 |

**바뀌는 케이스:** 없음
