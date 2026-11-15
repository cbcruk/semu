# 할 일 카드 수명

## 요약

- 홈 "오늘의 할 일" 카드는 신고 건 전이가 열고 닫습니다. 종류는 자료 제출, 매입매출장 확인, 신고 결과 확인, 납부 네 가지입니다
- 사용자는 카드를 완료(`done`)하거나 넘어가기(`skip`)만 합니다. 마감일이 지난 넘어가기는 `skipped_overdue`, 그 밖에는 `done`입니다
- 고객이 신고서·고지서를 처음 열면 신고 결과 확인 카드가 닫힙니다
- 진행중 탭은 마감일 순(마감일 없는 카드 맨 뒤), 완료 탭은 닫힌 시각 최근 순입니다. 메뉴 접근 판정을 통과한 카드만 보입니다

## 현행 위치

- 전이별 효과: `apps/api/legacy/src/modules/filings/filing-cards.ts` (`applyCardEffects`, `closeReviewCard`)
- 열기·닫기·정렬: `apps/api/legacy/src/modules/action-cards/action-cards.repository.ts`
- 사용자 완료: `apps/api/legacy/src/modules/action-cards/action-cards.service.ts` (`completeActionCard`)
- 문서 열람: `apps/api/legacy/src/modules/filings/filings.service.ts`
- 설계: `docs/reference/legacy-design/tax-api-design.md` 7절
- 매뉴얼: `manual/02-홈-Universal-Home/03-오늘의-할-일.md`, `manual/06-세무/01-부가세.md`

## 로직

| 전이 | 효과 |
|---|---|
| `request`, `reject`, `unsubmit` | 자료 제출 카드 열기, 마감일 = `submit_due` |
| `submit`, `startReview` | 자료 제출 카드 닫기 |
| `uploadLedger` | 매입매출장 확인 카드 열기, 마감일 = 신고 기한 − 3일(없으면 없음) |
| `confirmLedger`, `disputeLedger` | 매입매출장 확인 카드 닫기 |
| `file`, `recordNotice` | 신고 결과 확인 카드 열기(마감일 = 신고 기한, 없으면 납부 기한). 납부 세액 > 0이면 납부 카드도 열기(마감일 = 납부 기한) |
| `pay`, `close` | 납부 카드 닫기 |
| `cancel`, 일정 배치 취소 | 열린 카드 모두 닫기 |
| `startPreparing` | 없음 |

- 카드는 회사·신고 건·종류마다 하나입니다. 닫힌 카드를 다시 열면 `reopen_count`가 1 오르고 마감일이 바뀝니다. 열린 카드를 다시 열면 마감일만 바뀝니다
- 시스템이 닫으면 `done`입니다
- 사용자 완료: 닫힌 카드는 409. `skip`이고 오늘(서울) > 마감일이면 `skipped_overdue`, 아니면 `done`
- 문서 열람: 고객이 `return`·`notice`를 처음 열면 결과 확인 카드를 닫습니다. 납부서·매입매출장 열람, 대리인 열람은 닫지 않습니다

## 근거

`apps/api/legacy/src/modules/filings/filing-cards.ts`

```ts
case 'uploadLedger':
  open('confirm_ledger', filing.due_date === null ? null : addDays(filing.due_date, -3))
  return
case 'file':
case 'recordNotice':
  open('review_filing_result', filing.due_date ?? filing.payment_due)
  if ((filing.payable_amount ?? 0) > 0) open('pay_tax', filing.payment_due)
  return
```

`apps/api/legacy/src/modules/action-cards/action-cards.service.ts`

```ts
const overdue = card.due_date !== null && today > card.due_date
const status = reason === 'skip' && overdue ? 'skipped_overdue' : 'done'
```

매뉴얼은 완료 탭을 "마감일 내에 정상적으로 완료한 일"과 "기한이 지난 일"로 나눠 설명합니다.

## 서버 이전 시 주의

- 카드 제목(`2026년 4분기 부가세 자료 제출`)과 바로가기 경로를 서버가 만듭니다
- 매입매출장 확인 마감일은 영업일 보정 없이 신고 기한 − 3일이라 주말일 수 있습니다
- `done`은 마감일이 지나도 `done`이라 매뉴얼 설명과 다릅니다
- 카드를 메뉴 코드(`menu_code`)로 거르므로 메뉴 트리가 바뀌면 카드 노출도 바뀝니다
- 세무 밖 카드(기관 연동 등)를 같은 저장소에 둘지 정해져 있지 않습니다

## 픽스처

[`apps/api/test/fixtures/rules/action-card-lifecycle.json`](../../../apps/api/test/fixtures/rules/action-card-lifecycle.json): 35건 (모두 traced)

| 케이스 | 입력 요지 | 결과 |
|---|---|---|
| 전이 효과 17건 | 전이마다 | 열기·닫기와 마감일 |
| 사용자 완료 7건 | `done`/`skip` × 마감 전·당일·후, 마감일 없음, 닫힌 카드 | `done`/`skipped_overdue`/409 |
| 다시 열기 2건 | 닫힌 카드, 열린 카드 | `reopen_count` +1 / 마감일만 |
| 문서 열람 5건 | 고객의 신고서·고지서·납부서·매입매출장, 대리인의 신고서 | 신고서·고지서만 닫음 |
| 정렬 2건 | 진행중, 완료 | 마감일 순 / 최근 순 |
| 메뉴 판정 2건 | 열 수 없는 메뉴, 열 수 있는 메뉴 | 숨김 / 보임 |
