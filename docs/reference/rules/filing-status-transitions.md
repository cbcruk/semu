# 신고 건 상태 전이

## 요약

- 신고 건 상태는 `scheduled → requested → submitted → reviewing → (ledger_pending) → preparing → filed → settled`이고, 어디서든 정해진 상태에서 `cancelled`로 갑니다
- 전이는 이름 붙은 14개(`request`, `submit`, `unsubmit`, `startReview`, `reject`, `uploadLedger`, `confirmLedger`, `disputeLedger`, `startPreparing`, `file`, `recordNotice`, `pay`, `close`, `cancel`)이고, 전이마다 출발 상태와 행위자(고객 `client` 또는 대리인 `agency`)가 하나씩 정해져 있습니다
- 조건이 붙은 전이: 매입매출장 단계는 부가세만, `startPreparing`은 부가세 외 세목만, `recordNotice`는 예정고지 건만, `pay`는 납부 세액 > 0, `close`는 ≤ 0, `submit`은 고객 항목이 모두 답해졌을 때, `file`은 신고서 문서가 있을 때입니다

## 현행 위치

- 전이표: `apps/api/legacy/src/modules/filings/filing-status.ts` (`TRANSITIONS`, `canStartFrom`)
- 행위자·조건 검사와 저장: `apps/api/legacy/src/modules/filings/filings.service.ts` (`transition`)
- 설계: `docs/reference/legacy-design/tax-api-design.md` 4절 "신고 건 상태 머신", 9절 API 표
- 업무 설명: `manual/06-세무/01-부가세.md`

## 로직

| 전이 | 출발 | 도착 | 행위자 | 조건 |
|---|---|---|---|---|
| `request` | `scheduled` | `requested` | agency | |
| `submit` | `requested` | `submitted` | client | 자동 연계가 아닌 `pending` 항목이 없음 |
| `unsubmit` | `submitted` | `requested` | client | |
| `startReview` | `scheduled`·`requested`·`submitted` | `reviewing` | agency | |
| `reject` | `reviewing` | `requested` | agency | |
| `uploadLedger` | `reviewing` | `ledger_pending` | agency | 부가세. `ledger_pending`에서 다시 올리면 상태 전이 없이 문서만 교체 |
| `confirmLedger` | `ledger_pending` | `preparing` | client | |
| `disputeLedger` | `ledger_pending` | `reviewing` | client | |
| `startPreparing` | `reviewing` | `preparing` | agency | 부가세 외 |
| `file` | `preparing` | `filed` | agency | 신고서(`return`) 문서가 있음. 없으면 422 |
| `recordNotice` | `scheduled` | `filed` | agency | `kind = notice` |
| `pay` | `filed` | `settled` | client | 납부 세액 > 0 |
| `close` | `filed` | `settled` | agency | 납부 세액 ≤ 0 |
| `cancel` | `scheduled`·`requested` | `cancelled` | agency | |

- 검사 순서는 행위자 → 출발 상태 → 조건입니다. 행위자가 틀리면 상태와 상관없이 403 `PERMISSION_DENIED`, 출발 상태가 틀리면 409 `INVALID_TRANSITION`, 항목이 남았으면 422 `VALIDATION_FAILED`입니다
- 상태 전이 요청은 모두 `If-Match`가 필요하고, 없으면 428, 다르면 412입니다

## 근거

`apps/api/legacy/src/modules/filings/filing-status.ts`

```ts
export const TRANSITIONS = {
  request: { from: ['scheduled'], to: 'requested', actor: 'agency' },
  submit: { from: ['requested'], to: 'submitted', actor: 'client' },
  unsubmit: { from: ['submitted'], to: 'requested', actor: 'client' },
  startReview: { from: ['scheduled', 'requested', 'submitted'], to: 'reviewing', actor: 'agency' },
  reject: { from: ['reviewing'], to: 'requested', actor: 'agency' },
  uploadLedger: { from: ['reviewing'], to: 'ledger_pending', actor: 'agency' },
  confirmLedger: { from: ['ledger_pending'], to: 'preparing', actor: 'client' },
  disputeLedger: { from: ['ledger_pending'], to: 'reviewing', actor: 'client' },
  startPreparing: { from: ['reviewing'], to: 'preparing', actor: 'agency' },
  file: { from: ['preparing'], to: 'filed', actor: 'agency' },
  recordNotice: { from: ['scheduled'], to: 'filed', actor: 'agency' },
  pay: { from: ['filed'], to: 'settled', actor: 'client' },
  close: { from: ['filed'], to: 'settled', actor: 'agency' },
  cancel: { from: ['scheduled', 'requested'], to: 'cancelled', actor: 'agency' },
}
```

매뉴얼은 부가세 진행을 "자료 제출 → 자료 검토 → 매입매출장 확인 → 신고서 작성 → 납부 → 완료"로 설명합니다. 매입매출장 확인은 부가세에만 있습니다.

## 서버 이전 시 주의

- 예정고지 건도 `request`·`startReview`를 받습니다. 고지서로 끝나는 건이라 자료 요청 흐름이 의미가 없습니다
- `submitted`에서는 취소할 수 없어, 고객이 낸 뒤 의무가 사라지면 대리인이 먼저 `startReview`를 거쳐야 합니다
- 신고서 업로드(`POST /desk/filings/:id/documents`)와 `file`이 따로 요청이라, 둘 사이에 실패하면 문서만 남습니다
- 매입매출장 교체는 전이표에 없고 업로드 경로 안의 분기입니다
- 행위자 불일치와 권한 부족이 같은 `PERMISSION_DENIED`라 클라이언트가 구분하지 못합니다
- 기한이 지나도 제출을 받고 `is_overdue`만 켭니다

## 픽스처

[`apps/api/test/fixtures/rules/filing-status-transitions.json`](../../../apps/api/test/fixtures/rules/filing-status-transitions.json): 35건 (모두 traced)

| 케이스 | 입력 요지 | 결과 |
|---|---|---|
| 전이마다 정상 경로 | 출발 상태·행위자 맞음 | 도착 상태 |
| 행위자 틀림 | 고객의 `request`, 대리인의 `pay`, 고객의 `cancel` | `PERMISSION_DENIED` |
| 남은 항목 | `submit` + `pending` 항목 | `VALIDATION_FAILED` |
| 세목·종류 조건 | 원천세 `uploadLedger`, 부가세 `startPreparing`, 예정 신고 건 `recordNotice` | `INVALID_TRANSITION` |
| 예정고지 건 자료 요청 | `kind = notice`에 `request` | `requested` (막지 않음) |
| 신고서 없음 | `file` | `VALIDATION_FAILED` (`documents`) |
| 세액 부호 | `pay` 0원, `close` 납부 세액 남음 | `INVALID_TRANSITION` |
| 취소 | `scheduled`·`requested` 허용, `submitted`·`reviewing` 거절 | |
