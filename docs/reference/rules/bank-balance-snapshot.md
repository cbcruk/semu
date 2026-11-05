# 계좌 일별 잔액 스냅샷

## 요약

- 계좌·날짜마다 마감 잔액 하나를 남깁니다. 은행이 준 잔액(`SCRAPED`)이 거래 후 잔액으로 만든 값(`DERIVED`)보다 우선합니다
- 스냅샷이 없는 날은 직전 스냅샷을 이어 쓰고, 첫 스냅샷 전이면 0입니다
- 만든 값은 그날 마지막 거래(시각 역순, 같으면 수집 키 역순)의 거래 후 잔액입니다

## 현행 위치

- 병합·조회: `apps/api/legacy/src/modules/bookkeeping/bank/bank.repository.ts:100-133`
- 만든 값: `apps/api/legacy/src/modules/bookkeeping/ingestion/ingest-scraped-records.ts:319-330`

## 로직

- 병합: `incoming = SCRAPED || current = DERIVED`이면 바꿉니다. 즉 같은 출처끼리는 새 값이 이기고, 만든 값은 은행 값을 못 덮습니다
- 조회: `date ≤ 날짜`인 가장 최근 스냅샷의 `closingBalance`, 없으면 0
- 만든 값: 거래 후 잔액이 있는 거래를 `transactedAt DESC, externalKey DESC`로 정렬한 첫 행

## 근거

- 스펙 `docs/reference/spec/bookkeeping.md:254`
  > `bank_balance_snapshots`는 일별 시작·마감 잔액과 "기타 잔액 변동"을 계산할 때 씁니다(4.3절).
- 현행 SQL `ON CONFLICT ... WHERE excluded.source = 'scrap' OR bank_balance_snapshots.source = 'derived'`

## 서버 이전 시 주의

- 수집 묶음에서 거래가 닿은 날만 다시 만듭니다. 과거 날짜의 거래가 늦게 들어오면 그날 스냅샷만 바뀌고 이후 날짜는 그대로입니다
- 시각 비교가 문자열이라 오프셋이 섞이면 순서가 틀립니다. Integrations가 같은 오프셋으로 보내야 합니다

## 픽스처

`apps/api/test/fixtures/rules/bank-balance-snapshot.json` (9케이스)
