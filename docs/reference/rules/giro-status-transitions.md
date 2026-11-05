# 지로 고지서 상태 전이

## 요약

- 상태는 `TODO`(납부 필요), `UNKNOWN`(확인 필요), `DONE`(납부 완료·수동 완료), `HIDDEN`(숨김)입니다
- 사용자는 `TODO`·`UNKNOWN`을 수동 완료하거나 숨기고, `TODO`만 앱에서 납부합니다. 숨김을 되돌리는 커맨드는 없습니다
- 인터넷지로 전체 재수집이 납부 확인, 목록에서 사라짐, 다시 나타남을 반영합니다

## 현행 위치

- `apps/api/legacy/src/modules/bookkeeping/giros/giros.service.ts:44-60` (수동 완료·숨김), `71-102` (재수집), `137-160` (납부), `212-231` (`moveGiro`)

## 로직

| 지금 | 커맨드·재수집 | 다음 | 완료 이유 | 이력 |
| --- | --- | --- | --- | --- |
| `TODO`, `UNKNOWN` | 수동 완료 | `DONE` | `MARKED_BY_USER` | `MARKED_PAID` |
| `TODO`, `UNKNOWN` | 숨김 | `HIDDEN` | | `HIDDEN` |
| `TODO` | 앱 납부 성공 | `DONE` | `PAID_IN_APP` | `PAID` |
| 없음 | 미납으로 보임 | `TODO` | | `CREATED` |
| 없음 | 납부됨으로 보임 | `DONE` | `SEEN_PAID` | `CREATED` |
| `TODO`, `UNKNOWN` | 납부됨으로 보임 | `DONE` | `SEEN_PAID` | `SEEN_PAID` |
| `UNKNOWN` | 미납으로 다시 보임 | `TODO` | | `REOPENED` |
| `TODO` | 목록에 없음 | `UNKNOWN` | | `MARKED_UNKNOWN` |
| `DONE`, `HIDDEN` | 재수집 | 그대로 | | |

- 현행 이름과의 대응: `manual_done` → `MARK_PAID`/`MARKED_BY_USER`, `scraped` → `SEEN_PAID`, `payment` → `PAID_IN_APP`

## 근거

- 스펙 `docs/reference/spec/bookkeeping.md:554-556`
  > `unknown` | 확인 필요 | 납부기한 초과, 청구기관 취소, 고지서 취소, 별도 직접 납부 등으로 고지 목록에서 사라진 경우

## 서버 이전 시 주의

- 현행 납부는 `request_id`로 멱등입니다. 재설계는 `Idempotency-Key` 헤더(필수)로 같은 일을 합니다
- 재수집은 전체 목록 기준입니다. 일부만 보내면 나머지 `TODO`가 모두 `UNKNOWN`이 됩니다
- 응답의 `allowedCommands`가 지금 상태에서 보낼 수 있는 커맨드를 알려 줍니다

## 픽스처

`apps/api/test/fixtures/rules/giro-status-transitions.json` (13케이스)
