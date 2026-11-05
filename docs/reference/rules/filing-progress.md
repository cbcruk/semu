# 신고 건 진행 단계와 기한 경과

## 요약

- 신고 건 상태를 화면 진행 막대의 단계로 바꿉니다. 부가세는 6단계, 그 밖의 세목은 5단계입니다
- `scheduled`와 `cancelled`는 단계가 없습니다(0)
- 기한 경과(`is_overdue`)는 신고서를 내기 전 상태에서 신고 기한(없으면 납부 기한)이 오늘보다 앞일 때 참입니다. 기한 당일은 경과가 아닙니다

## 현행 위치

- 단계: `apps/api/legacy/src/modules/filings/process-step.ts` (`PROCESS_STEPS`, `processStepOf`)
- 기한 경과: `apps/api/legacy/src/modules/filings/filings.serializer.ts` (`isOverdue`)
- 진행 현황: `apps/api/legacy/src/modules/tracker/tracker.service.ts` (`listTracker`, `GET /home/tracker`)
- 설계: `docs/reference/legacy-design/tax-api-design.md` 7절 "트래커의 단계 표시"

## 로직

| 상태 | 부가세 | 그 밖의 세목 |
|---|---|---|
| `requested` | 1 자료 제출 가능 | 1 자료 제출 가능 |
| `submitted`, `reviewing` | 2 자료 검토중 | 2 자료 검토중 |
| `ledger_pending` | 3 매입매출장 확인 | (없음) |
| `preparing` | 4 부가세 작업중 | 3 작업중 |
| `filed` | 5 부가세 납부 | 4 납부 |
| `settled` | 6 부가세 마감 | 5 마감 |
| `scheduled`, `cancelled` | 0 | 0 |

- 기한 경과 = 상태가 `scheduled`–`preparing` 중 하나이고 `(due_date ?? payment_due) < 오늘`(회사 시간대)

## 근거

`apps/api/legacy/src/modules/filings/process-step.ts`

```ts
export const PROCESS_STEPS = {
  surtax: ['자료 제출 가능', '자료 검토중', '매입매출장 확인', '부가세 작업중', '부가세 납부', '부가세 마감'],
  default: ['자료 제출 가능', '자료 검토중', '작업중', '납부', '마감'],
}
```

부가세 단계 이름은 현행 클라이언트의 `ProcessStep` enum과 같습니다. 그 밖의 세목 이름은 부가세 이름에서 세목을 뺀 추정입니다.

## 서버 이전 시 주의

- 단계 이름을 한글 문구로 내려줍니다
- `submitted`와 `reviewing`이 같은 단계라 고객은 대리인이 검토를 시작했는지 모릅니다
- 진행 현황이 신고 건 목록과 같은 데이터를 다른 경로(`/home/tracker`)로 줍니다
- 예정고지 건은 신고 기한이 없어 납부 기한으로 경과를 판정합니다

## 픽스처

[`apps/api/test/fixtures/rules/filing-progress.json`](../../../apps/api/test/fixtures/rules/filing-progress.json): 19건 (모두 traced)

| 케이스 | 입력 요지 | 결과 |
|---|---|---|
| 부가세 9건 | 상태마다 | 단계 이름·위치·6 |
| 원천세·법인세 5건 | 상태마다 | 단계 이름·위치·5 |
| 기한 경과 5건 | 기한 지남, 당일, 신고 후, 예정고지, 취소 | 참/거짓/거짓/납부 기한으로 판정/거짓 |
