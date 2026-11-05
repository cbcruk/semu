# 거래처 실시간 미정산 금액

## 요약

- 거래처별 `분류된 증빙 합계 − 그 증빙에 연결된 입출금 금액`을 매출·매입으로 나눠 셉니다
- 미분류 증빙과 거래처가 없는 증빙은 뺍니다
- 결산 기준 미수·미지급(세무 보고서)과는 다른 숫자입니다

## 현행 위치

- `apps/api/legacy/src/modules/bookkeeping/partners/partners.repository.ts:107-137` (`unsettledAmounts`)

## 로직

- 매출: `Σ 합계 − Σ 연결 금액` (분류된 매출 증빙)
- 매입: `Σ COALESCE(합계, 공급가액 + 세액) − Σ 연결 금액` (분류된 매입 증빙)
- 취소(음수) 증빙은 그대로 더해 금액을 줄입니다

## 근거

- 스펙 `docs/reference/spec/bookkeeping.md:334-341`
  > unsettled_sales_amount = Σ sales_evidence.total_amount (partner_id=p, 분류 계정이 '매출' 계열) − Σ settlement_links.amount (sales 측, 해당 증빙)
- 스펙 `docs/reference/spec/bookkeeping.md:343`
  > 결산 기반 미수·미지급(4.6절)과는 **다른 숫자**입니다.

## 서버 이전 시 주의

- 현행 매출 테이블은 합계가 `NOT NULL`이라 매출 쪽에 `COALESCE`가 없습니다. 재설계는 합계 없는 매출 증빙을 받으므로 양쪽 모두 `evidence-amounts`의 합계를 씁니다
- 스펙은 "매출 계열 계정"만 센다고 적었지만 현행 코드는 분류만 되어 있으면 계정과 상관없이 셉니다. 재설계는 코드를 따릅니다

## 픽스처

`apps/api/test/fixtures/rules/partner-outstanding-amount.json` (4케이스)
