# 수동 수집 쿨다운과 진행 상태

## 요약

- 사용자가 `내역 업데이트`(수동 수집)를 누르면 서비스별 마지막 수집 요청의 `canScrapping`·`remainSeconds`로 버튼을 켜고 끕니다. 클라이언트는 서버 값을 그대로 그립니다
- 이전 구현(레거시 서버)은 사용자 요청 뒤 **600초 쿨다운**을 두고, 진행 중인 요청은 시작 후 600초(타임아웃)까지 새 요청을 막습니다. 시스템(정기) 요청은 쿨다운을 만들지 않습니다
- 쿨다운 중 요청은 429 `RATE_LIMITED` + `remain_seconds`입니다
- 진행 폴링은 요청 묶음을 `PROGRESS | SUCCESS | FAIL` 하나로 줄입니다. 하나라도 실패하면 묶음 전체가 `FAIL`입니다

## 현행 위치

- 번들: `ScrapRequestStatus` enum(B:89228), 데모 목업 `last-scrap-request-status`(B:91137-91170), 폴링 `getCurrentScrappingStatus`(B:89314)
- 레거시 서버: `apps/api/legacy/src/modules/platform/integrations/scrap.service.ts`, `integrations.utils.ts`의 `serializeScrapRequest`
- 화면: 설정 > 내역 수집 기관 연동, 각 거래 화면의 `내역 업데이트` 버튼

## 로직

- 마지막 요청이 없으면 `{ canScrapping: true, remainSeconds: 0, isInitial: true }`
- `remainSeconds = requester === 'user' && nextAvailableAt ? ceil(nextAvailableAt − now) : 0` (음수는 0)
- `canScrapping = status !== 'request' && remainSeconds === 0`
- 수동 요청 거절 판정(`cooldownRemaining`)
  - 마지막 요청이 `request`이고 `timeoutAt` 전이면 `max(remain, 1)`초로 거절. 타임아웃이 지났으면 진행 중이어도 받습니다
  - 그 밖에는 `remain > 0`이면 거절
- 새 요청: `nextAvailableAt = timeoutAt = now + 600초`, `isInitial`은 그 서비스의 수집 결과가 하나도 없을 때 참
- 연동이 하나도 없으면 400 `VALIDATION_FAILED`(`service`)
- 전체 수집(`request-all-scrapping`)은 연동이 있고 쿨다운이 아닌 서비스만 같은 그룹 ID로 넣습니다
- 폴링: 요청 중 하나라도 `request`면 `PROGRESS`, 아니면 `timeout`이 있거나 결과 중 `fail`이 있으면 `FAIL`, 나머지는 `SUCCESS`

## 근거

`docs/reference/spec/platform.md:287-289`

> - `ScrapRequestStatus = request | done | timeout`(B:89228). `GET /integrations/:service/last-scrap-request-status` 응답(데모 B:91137-91170): `{ id, company, service, requester: 'user'|'system', code, message, status, isInitial, canScrapping, remainSeconds, created, modified }` → **수동 수집 쿨다운**(`canScrapping=false`, `remainSeconds`).
> - `POST /integrations/request-all-scrapping/`: 전체 재수집. `GET /integrations/scraping-status/?id=` → `ScrappingStatus = PROGRESS | SUCCESS | FAIL`(폴링, store `timeoutId`).

`docs/reference/spec/platform.md:364-365`

> - 진행 표시 `ScrappingStatus`: 하나라도 request면 `PROGRESS`, 모두 done이고 실패 없음 `SUCCESS`, 아니면 `FAIL`(추정).
> - `canScrapping=false` 동안 수동 요청 → 429 + `remainSeconds`.

`apps/api/legacy/src/modules/platform/integrations/integrations.utils.ts` (발췌)

```ts
export const SCRAP_COOLDOWN_SECONDS = 600
export const SCRAP_TIMEOUT_SECONDS = 600
const remain = row.requester === 'user' && row.next_available_at !== null ? secondsUntil(now, row.next_available_at) : 0
can_scrapping: row.status !== 'request' && remain === 0,
```

`apps/api/legacy/src/modules/platform/integrations/scrap.service.ts` (발췌)

```ts
const stale = latest.timeout_at !== null && !isBefore(now, latest.timeout_at)
if (latest.status === 'request' && !stale) return Math.max(remain, 1)
return remain > 0 ? remain : null
```

수집 주기 (매뉴얼)

- `alfred-manual/08-설정/07-내역-수집-기관-연동/04-PG사-연동하기.md`: "연동 완료 후 오전 10시, 오후 22시 하루에 두 번 내역이 업데이트됩니다." "연동 후 익일 10시에 최근 3개월치 내역이 업데이트 됩니다."
- `alfred-manual/08-설정/07-내역-수집-기관-연동/06-배달-매출-연동하기.md`: "연동이 완료되면 최근 90일의 배달 매출 데이터가 업데이트 됩니다." "매일 오전 10시경 이전 5일치 매출이 업데이트 됩니다." "주문일로 부터 5일 이내 취소 완료될 경우, 내역 업데이트시 주문건 취소가 반영됩니다."
- `alfred-manual/08-설정/07-내역-수집-기관-연동/02-올라-쇼핑몰-매출-연동하기.md`: "익일 6시부터 … 조회할 수 있습니다." "최초 연동시 최근 1개월 데이터 부터 연동됩니다."
- `alfred-manual/08-설정/06-세무신고-기관-연동/02-연동-은행계좌-연동하기.md`: "등록 후 **1일**이 지나야 확인이 가능합니다."

## 픽스처

[`apps/api/test/fixtures/rules/scrap-cooldown.json`](../../../apps/api/test/fixtures/rules/scrap-cooldown.json): 17건 (추적 17)

| 케이스 | 입력 | 결과 |
|---|---|---|
| 첫 요청 | 이전 요청 없음 | `canScrapping: true`, `isInitial: true` |
| 1분 전 사용자 요청 | `done`, +600초 | `remainSeconds: 540` |
| 정확히 600초 | | `canScrapping: true` |
| 시스템 요청 | `requester: system` | 쿨다운 없음 |
| 시스템 요청 진행 중 | `request` | 버튼 꺼짐, `remainSeconds: 0` |
| 쿨다운 중 요청 | | 429 `remain_seconds: 300` |
| 진행 중 + 타임아웃 지남 | | 새 요청 접수 |
| 전체 수집 | 쿨다운·미연동 서비스 | 건너뜀 |
| 폴링 | `request` 포함 / 실패 결과 / `timeout` | `PROGRESS` / `FAIL` / `FAIL` |

## 서버 이전 시 주의

- 600초는 레거시 서버가 정한 값입니다. 번들에는 실제 간격이 없습니다. 정책값으로 두고 서비스별로 다르게 할 수 있게 합니다
- 수집 요청은 재설계에서 `Job`이 됩니다. `request|done|timeout`과 `PROGRESS|SUCCESS|FAIL` 두 축을 `QUEUED|RUNNING|SUCCEEDED|PARTIALLY_SUCCEEDED|FAILED` 하나로 합치면, 일부 실패가 묶음 전체 `FAIL`로 보이는 문제도 없어집니다
- 진행 중인 시스템 요청이 버튼을 막는데 `remainSeconds`는 0이라 화면에 남은 시간이 나오지 않습니다. 진행 중이면 "수집 중" 상태로 따로 알려야 합니다
- 쿨다운 단위(서비스/연동/항목)가 정해지지 않았습니다. 항목 하나만 다시 수집해도 서비스 전체가 막힙니다
- 정기 수집 주기(은행 1일, PG 10시·22시, 배달 10시 5일치, 올라 06시, 지원금 04시)는 서버 스케줄러에 정책으로 둡니다. 은행 1일은 매일 07:00 한 번으로 읽었고 카드도 매일 07:30에 돕니다(2026-11-14, #109). 시스템 요청은 쿨다운을 남기지 않습니다

