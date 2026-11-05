# 자금 현황 기타 변동

## 요약

- 시작 잔액은 시작일 전날 마감 잔액 합계, 마감 잔액은 종료일 마감 잔액 합계입니다
- 입금은 양수 금액, 출금은 음수 금액의 합계입니다
- `기타 변동 = 마감 − 시작 − 입금 − 출금`이고, 이자 결산·수집 누락·외화 환산 차이를 보여 줍니다

## 현행 위치

- `apps/api/legacy/src/modules/bookkeeping/realtime-reports/realtime-reports.service.ts:193-249` (`cashDaily`)
- 잔액 조회: `apps/api/legacy/src/modules/bookkeeping/bank/bank.repository.ts:124-133`

## 로직

- 대상 계좌: 입출금(`01`)·외화(`31`)이고 자금 현황에 보이는 계좌
- 계좌마다 `bank-balance-snapshot`의 마감 잔액 조회로 시작·마감을 구해 더합니다
- 그 기간 거래로 입금·출금을 구하고 나머지를 기타 변동으로 둡니다
- 분류별 보기는 입금·출금을 계정과목(미분류는 `미분류 입금`·`미분류 출금`)별로 묶습니다
- 홈 요약은 어제 하루를 씁니다

## 근거

- 스펙 `docs/reference/spec/bookkeeping.md:666-674`
  > 시작 잔액 = Σ_visible_accounts closing_balance(date − 1)
  >
  > 기타 잔액 변동 = 마감 − 시작 − 입금액 − 출금액     (이자 결산·스크래핑 누락·외화 환산 차이 등)

## 서버 이전 시 주의

- 기간 중에 첫 스냅샷이 생긴 계좌(새로 연동한 계좌)는 잔액 전체가 기타 변동으로 잡힙니다
- 외화 계좌 잔액을 원화로 바꾸지 않고 그대로 더합니다
- 데모 2026-10-31(시작 71,730,000, 마감 73,450,000, 기타 20,000)이 현행과 같습니다

## 픽스처

`apps/api/test/fixtures/rules/cash-status-other-change.json` (4케이스)
