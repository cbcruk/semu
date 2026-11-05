# 증빙 연결 상태

## 요약

- 거래대금(`trade`) 그룹으로 분류한 입출금만 증빙과 맞춥니다. 나머지는 `NOT_APPLICABLE`입니다
- 거래처가 없으면 `PARTNER_REQUIRED`(화면 "거래처 필요"), 연결 금액 합계가 거래 금액 절댓값과 같으면 `MATCHED`, 아니면 `UNMATCHED`입니다
- 입금은 매출 증빙, 출금은 매입 증빙에만 연결하고, 증빙·거래 어느 쪽도 넘치게 연결할 수 없습니다

## 현행 위치

- 상태: `apps/api/legacy/src/modules/bookkeeping/bank/bank.utils.ts:46-50`
- 다시 계산: `apps/api/legacy/src/modules/bookkeeping/bank/bank.repository.ts:209-226`
- 연결 검사: `apps/api/legacy/src/modules/bookkeeping/bank/bank.service.ts:155-183`

## 로직

- 상태: 위 요약 순서대로 판정합니다
- 연결 검사(링크마다 순서대로)
  - 금액 ≤ 0 → `AMOUNT_NOT_POSITIVE`
  - 입금↔매출, 출금↔매입이 아니면 `SIDE_MISMATCH`
  - 거래와 증빙 둘 다 거래처가 있는데 다르면 `PARTNER_MISMATCH`
  - `다른 거래가 이 증빙에 건 금액 + 이번 금액 > |증빙 합계|` → `EXCEEDS_EVIDENCE`
  - 마지막으로 `남는 연결 + 이번 연결 합 > |거래 금액|` → `EXCEEDS_TRANSACTION`
- 증빙 합계는 `evidence-amounts` 규칙으로 채운 값입니다

## 근거

- 스펙 `docs/reference/spec/bookkeeping.md:281`
  > 증빙 연결(매칭)은 N:M으로 둡니다. 부분 입금과 묶음 입금이 있기 때문입니다.
- 스펙 `docs/reference/spec/bookkeeping.md:290-296`의 판정표(추정)

## 서버 이전 시 주의

- 현행은 `settlement_status`를 저장하고 분류·연결이 바뀔 때 다시 계산했습니다. 재설계는 읽을 때 계산합니다(저장 상태 어긋남 없음, 목록 필터는 메모리에서)
- 현행 연결은 증빙별 upsert + 따로 해제였습니다. 재설계 `POST /bank-transactions/{id}:link`는 거래의 연결 전체를 바꿉니다(빈 배열 = 모두 해제)
- 거래처 불일치는 양쪽이 모두 있을 때만 막습니다. 증빙 거래처가 비어 있으면 통과합니다

## 픽스처

`apps/api/test/fixtures/rules/settlement-match-status.json` (10케이스)
