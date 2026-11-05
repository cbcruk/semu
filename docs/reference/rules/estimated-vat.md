# 예상 부가세

## 요약

- 오늘이 속한 기간(법인 분기, 개인 반기)의 매출세액 − 매입세액을 수집한 증빙으로 계산합니다. 음수면 환급 예상입니다
- 매출세액은 세금계산서·현금영수증·카드·PG만 더하고, 몰·배달은 내역에만 보여 줍니다. 세액이 없는 카드 매출은 합계에서 나누고 과세 비율을 곱합니다
- 매입세액은 공제 분류된 매입만 더합니다. 불공제·미분류는 개수만 따로 알려 줍니다
- 반기별 추이는 세무 기장 고객이면 확정 신고한 반기에 신고 세액을, 그 밖에는 예상 세액을 씁니다

## 현행 위치

- 계산: `apps/api/legacy/src/modules/estimated-vat/estimated-vat.utils.ts` (`vatPeriodFor`, `halfPeriod`, `salesVatOf`, `dedupeSales`)
- 조회·추이: `apps/api/legacy/src/modules/estimated-vat/estimated-vat.service.ts`
- 세액 나누기·비율: `apps/api/legacy/src/lib/money.ts` (`splitVatFromTotal`, `applyBasisPoints`)
- 설계: `docs/reference/legacy-design/tax-api-design.md` 6절
- 매뉴얼: `alfred-manual/02-홈-Universal-Home/04-실시간-보고서/02-예상-부가세.md`

## 로직

- 기간: 법인은 날짜가 속한 분기, 개인은 반기(1–6월, 7–12월). 기간 시작부터 그 날짜까지의 증빙을 씁니다
- 매출 한 건의 세액
  - `vat_amount`가 있으면 그 값
  - 없으면 `splitVatFromTotal(total)` = 부호 × (`|total|` − `floor(|total| × 10 / 11)`)
  - 카드는 여기에 `applyBasisPoints(vat, taxable_card_ratio_bp)` = 0 쪽으로 버림(`trunc(vat × bp / 10000)`)
- 중복: 같은 `dedupe_group`의 매출은 발행일·ID 순으로 먼저 온 한 건만 셉니다
- 예상 세액 = Σ 포함 출처 매출세액 − Σ 공제 매입세액
- 출처별 내역에 세액, 합계 포함 여부, 마지막 수집 시각을 둡니다
- 추이: 올해 포함 `years`해의 반기마다 한 점. 아직 시작하지 않은 반기는 뺍니다. 세무 기장 고객이고 그 반기의 확정 신고가 `filed`·`settled`면 예정·확정 신고 세액 합(예정고지 제외), 아니면 예상 세액

## 근거

`apps/api/legacy/src/lib/money.ts`

```ts
export function splitVatFromTotal(total: number): number {
  assertWon(total)
  const absolute = Math.abs(total)
  const vat = absolute - Math.floor((absolute * 10) / 11)
  return total < 0 ? -vat : vat
}
```

매뉴얼은 예상 부가세를 "수집된 매출·매입 자료로 계산한 참고 금액"으로 설명하고, 확정 신고 세액과 다를 수 있다고 안내합니다.

## 서버 이전 시 주의

- 몰·배달 매출은 PG와 겹칠 수 있어 `dedupe_group`이 채워지기 전까지 합계에서 뺍니다
- 미분류 매입을 빼므로 분류가 늦으면 예상 세액이 높게 나옵니다
- 카드 과세 비율이 bp(1/10,000) 단위입니다
- 법인 예상 부가세는 분기, 추이는 반기라 단위가 다릅니다
- 응답에 `is_refund`와 출처별 `last_scrap_status`가 있습니다

## 픽스처

[`apps/api/test/fixtures/rules/estimated-vat.json`](../../../apps/api/test/fixtures/rules/estimated-vat.json): 16건 (모두 traced)

| 케이스 | 입력 요지 | 결과 |
|---|---|---|
| 기간 4건 | 법인 11월·3월 31일, 개인 6월 30일·7월 1일 | 분기 / 반기 |
| 매출세액 6건 | 카드 11,000 / −11,000 / 10,000, 비율 50%, 기록된 세액 | 1,000 / −1,000 / 910 / 500 / 그대로 |
| 기간 합계 2건 | 출처가 섞인 분기, 매입이 큰 분기 | 예상 세액 / 환급 |
| 추이 4건 | 세무 기장 법인, 무료 고객, 예정고지 포함, 시작 전 반기 | 확정 / 예상 / 고지 제외 / 뺌 |
