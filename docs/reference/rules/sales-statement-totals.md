# 거래명세서 합계 검증

## 요약

- 공급가액 합계는 품목 공급가액의 합, 세액 합계는 품목 세액의 합, 합계는 `공급가액 + 세액`이어야 합니다
- 계산서(면세, 구분 `03`)와 영세율(종류 `02`)은 세액이 0이어야 합니다
- 수정 발행(구분 `02`·`04`)과 위수탁(종류 `03`·`04`)은 받지 않고, 발급한 명세서는 고칠 수 없습니다

## 현행 위치

- 검증: `apps/api/legacy/src/modules/bookkeeping/transaction-sales/transaction-sales.service.ts:172-185`
- 잠금: `transaction-sales.service.ts:167-169`, `transaction-sales.repository.ts:12` (발급 완료 건수)
- 품목 요약: `apps/api/legacy/src/modules/bookkeeping/transaction-sales/transaction-sales.utils.ts:56-60`

## 로직

- 문제 코드: `UNSUPPORTED`(`invoiceKindCode`, `invoiceClassCode`), `AMOUNT_MISMATCH`(`supplyAmount`, `vatAmount`, `totalAmount`)
- 잠금: 발급 완료(`ISSUED`) 건이 있으면 `ISSUED`, 발급 중(`ISSUING`)이 있으면 `ISSUING`, 아니면 `EDITABLE`. 실패 건은 잠그지 않습니다
- 품목 요약: `첫 품목 외 N건`, 하나면 그 이름

## 근거

- 스펙 `docs/reference/spec/bookkeeping.md:401-402`
  > 위수탁은 미지원입니다.
  >
  > 발급 후 수정 발행은 미지원입니다. 그러므로 `invoice_count ≥ 1`이면 PATCH와 DELETE에 409를 돌려준다고 추정합니다.
- 스펙 `docs/reference/spec/bookkeeping.md:360` 종류 코드 `01` 일반, `02` 영세율, `03` 위수탁, `04` 영세율위수탁

## 서버 이전 시 주의

- 현행은 첫 문제 하나를 던졌습니다. 재설계는 422 `problems`에 모두 담습니다
- 발급은 `Idempotency-Key`로 멱등이고, 홈택스 응답을 기다리는 동안 `ISSUING`으로 재발급·수정을 막습니다(409 `SalesTransactionLocked`)

## 픽스처

`apps/api/test/fixtures/rules/sales-statement-totals.json` (10케이스)
