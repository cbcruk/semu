# 증빙 금액 채우기

## 요약

- 원천이 준 공급가액·세액·합계 가운데 빠진 값을 채웁니다
- 합계가 있으면(주로 매출) 세액을 공급가액에서, 공급가액도 없으면 합계에서 나눠 구합니다(`합계 − ⌊합계 × 10 / 11⌋`)
- 합계가 없으면(주로 매입) 빠진 값을 0으로 보고 `합계 = 공급가액 + 세액`입니다

## 현행 위치

- `apps/api/legacy/src/modules/bookkeeping/evidence/evidence.utils.ts:22-30` (`evidenceAmounts`)
- `apps/api/legacy/src/lib/money.ts:16-22` (`splitVatFromTotal`)

## 로직

- 합계 있음
  - 세액 = 받은 세액 ?? (공급가액이 없으면 `splitVatFromTotal(합계)`, 있으면 `합계 − 공급가액`)
  - 공급가액 = 받은 공급가액 ?? `합계 − 세액`
- 합계 없음: 공급가액 = 받은 값 ?? 0, 세액 = 받은 값 ?? 0, 합계 = 둘의 합
- `splitVatFromTotal`은 절댓값으로 나누고 부호를 되돌립니다(취소)
- 세 값이 다 있으면 서로 맞지 않아도 그대로 둡니다

## 근거

- 스펙 `docs/reference/spec/bookkeeping.md:636`
  > 카드처럼 공급가액이 없는 증빙은 기존 `splitVatFromTotal`로 나눕니다. 다만 면세나 간이 가맹점이면 total을 그대로 씁니다(미확인).

## 서버 이전 시 주의

- 세액을 나눠 낸 값인지 재설계 응답에 `vatEstimated`로 표시합니다
- 면세·간이 가맹점 구분이 없어 카드 매출은 늘 10/110으로 나눕니다
- 실시간 손익, 미정산, 증빙 연결 검사, VAT 증빙 조회가 모두 이 값을 씁니다

## 픽스처

`apps/api/test/fixtures/rules/evidence-amounts.json` (8케이스)
