# 추가 급여대장 생성 조건

## 요약

계산중이거나 완료된 정기 급여대장이 있는 귀속월에만 추가 급여대장을 만들 수 있습니다. 회사에 입력가능 대장이 있거나, 지급월 원천세가 신고됐거나, 신고 마감일(다음 달 10일) 5일 전부터는 만들 수 없습니다. 추가 대장은 일용·사업·기타 소득만 받습니다.

## 현행 위치

- 화면: 계산중·완료 카드 상세의 "급여카드 추가" 버튼, `can-create-additional-card`가 노출을 판정
- 재설계 전 구현: `apps/api/legacy/src/modules/payroll/cards/cards.service.ts:98-123`(`additionalCardBlocker`)

## 로직

처음 걸린 규칙 하나를 돌려줍니다.

1. 귀속월에 정기 대장이 없으면 `NO_REGULAR_LEDGER`
2. 정기 대장이 입력 중이면 `REGULAR_LEDGER_NOT_SUBMITTED`
3. 회사에 입력 중인 대장이 있으면 `DRAFT_LEDGER_EXISTS`
4. 지급월 원천세가 신고됐으면 `WITHHOLDING_FILED`
5. 오늘 ≥ 다음 달 10일 − 5일이면 `WITHHOLDING_DEADLINE_NEAR`

## 근거

- 매뉴얼 `alfred-manual/05-급여/01-급여-관리/01-급여-급여-관리-추가-급여-생성-및-입력-업데이트.md`
  - `:11` "계산중 혹은 완료된 급여 외에 추가로 계산이 필요한 급여카드를 입력할 수 있는 기능"
  - `:17` "**추가 급여카드는 일용, 사업, 기타 소득만 지원**합니다"
  - `:22-23` "`입력가능` 상태의 급여카드가 있는 경우 생성되지 않습니다", "원천세가 신고된 경우, 혹은 마감일 5일 전 부터는 추가 급여카드 생성이 불가합니다"
  - `:27` "계산 요청 전에 가능합니다"(삭제)
  - `:43-44` "해당 급여 원천세 신고 마감일 -5일 전까지만 생성할 수 있습니다", "9월 10일 원천세 신고: 8월 5일까지 생성 및 계산요청 가능"
- 스펙 1.4(`docs/reference/spec/payroll.md:80-89`): "예시의 날짜 산식이 앞뒤가 맞지 않으므로 **기준일은 확인 필요**"

## 서버 이전 시 주의

- 매뉴얼 예시(9월 10일 신고 → 8월 5일까지)는 "5일 전"과 맞지 않습니다. 재설계 전 구현처럼 9월 5일부터 막습니다
- "오늘"은 회사 시간대(Asia/Seoul) 날짜입니다
- 원천세 신고는 409 `WITHHOLDING_FILED`, 나머지는 409 `ADDITIONAL_LEDGER_BLOCKED`(`reason`)입니다
- 정기 대장은 추가 대장이 있으면 지울 수 없습니다(409 `PAYROLL_LEDGER_HAS_ADDITIONAL`)

## 픽스처

`apps/api/test/fixtures/rules/additional-payroll-ledger.json`: 규칙 다섯 개와 허용 6건
