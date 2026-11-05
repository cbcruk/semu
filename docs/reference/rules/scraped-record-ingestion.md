# 수집 레코드 반영

## 요약

- Integrations가 보낸 수집 묶음을 계좌 먼저, 나머지는 보낸 순서대로 반영합니다
- 같은 원천·수집 키(`externalKey`)가 다시 오면 덮어쓰되 분류·거래처·메모는 지킵니다(멱등)
- 카드 승인은 매입 카드 증빙이 됩니다. 받을 수 없는 레코드는 그 레코드만 거절하고 인덱스와 이유를 돌려줍니다

## 현행 위치

- `apps/api/legacy/src/modules/bookkeeping/ingestion/ingest-scraped-records.ts:61-153` (반영), `220-238` (카드), `363-365` (순서)

## 로직

- 순서: `BANK_ACCOUNT`는 0, 나머지는 1. 같은 순위는 보낸 순서(안정 정렬)
- 카드 승인 → 매입 증빙
  - 수집 키 `승인번호:마스킹 카드번호:승인시각`
  - 날짜는 승인시각의 날짜
  - 합계 = 승인 금액, 세액 = 받은 값 또는 0, 공급가액 = 합계 − 세액
  - 취소 여부는 받은 값, 없으면 `금액 < 0`
- 거절 이유(재설계): `EXTERNAL_KEY_MISSING`, `DATE_INVALID`, `SOURCE_SIDE_MISMATCH`(매입인데 PG·쇼핑몰·배달), `AMOUNTS_MISSING`(합계·공급가액 모두 없음), `BANK_ACCOUNT_UNKNOWN`
- 반영 뒤: 거래처를 사업자번호로 잇고, 닿은 날의 잔액 스냅샷을 다시 만들고, 지로 목록을 갱신하고, 새 행에 `FILL_EMPTY` 자동분류를 돌립니다

## 근거

- 현행 코드 주석 `ingest-scraped-records.ts:31-33`
  > **Idempotent.** Evidence upserts on `(company, source, external_key)`, bank transactions on `(company, account, external_key)`
- 스펙 `docs/reference/spec/bookkeeping.md:180-181`
  > **적용 시점**: 신규 수집분에는 자동으로 적용합니다.

## 서버 이전 시 주의

- 현행 카드 날짜는 `approved_at.slice(0, 10)`이라 UTC 시각이면 하루 앞당겨집니다. 재설계는 회사 시간대 날짜입니다
- 현행은 금액 없는 매출 증빙(합계 `NOT NULL`)이나 매입 PG 증빙(원천 `CHECK`)을 DB 오류로 받아 묶음 전체를 되돌렸습니다(픽스처 `BATCH_FAILS`). 재설계는 그 레코드만 거절합니다
- 빈 수집 키는 현행이 그대로 받았습니다. 재설계는 거절합니다
- 공개 진입점은 `bookkeeping.public.ts`의 `ScrapedRecordIngestion.ingest`입니다. HTTP 엔드포인트는 없습니다

## 픽스처

`apps/api/test/fixtures/rules/scraped-record-ingestion.json` (9케이스, 4케이스 바꿈)
