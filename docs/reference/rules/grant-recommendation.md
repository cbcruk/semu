# 지원금 추천

## 요약

- 화면은 두 목록입니다. 왼쪽 `전체 지원금`은 지금 신청할 수 있는 공고 전체, 오른쪽 `맞춤 추천`은 그중 회사의 **업종·지역**에 맞는 공고 최대 15개입니다
- 노출 기준은 `신청 시작 ≤ 오늘 ≤ 마감`이거나 상시 모집입니다. 업종이 명확하지 않으면 업종으로 거르지 않습니다
- 목록은 매일 04:00에 갱신합니다
- 레거시 서버는 시작일을 보지 않았고, 15개 상한이 없었으며, 업종이 없는 회사에는 업종 제한 없는 공고만 추천했습니다

## 현행 위치

- 화면: 추천 > 지원금 추천(`/recommend/grant`, `requiresMenuAccess: false`), 홈의 '찾은 혜택'
- 번들: 화면은 lazy chunk. 업종 데이터 후보는 remittance `GET get-business_types`, `POST update-business_types`(B:89485-89488)
- 레거시 서버: `apps/api/legacy/src/modules/platform/assistant/assistant.service.ts`의 `recommendGrants`

## 로직

- 전체 지원금: `applyStartOn <= today && (applyEndOn === null || today <= applyEndOn)`
- 맞춤 추천 (매뉴얼): 전체 지원금 중
  - 지역: 공고 지역이 비어 있거나(전국) 회사 지역을 포함
  - 업종: 회사 업종이 불명확하면 통과, 아니면 공고 업종이 비어 있거나 회사 업종 중 하나를 포함
  - 최대 15개
- 레거시 서버
  - `apply_end_on IS NULL OR apply_end_on >= today`만 확인 (시작일 미확인)
  - 지역: `regions.length === 0 || (region !== null && regions.includes(region))`
  - 업종: `codes.length === 0 || codes.some(code => industries.has(code))` — 회사 업종이 비면 업종 제한 공고는 모두 빠짐
  - 정렬: 마감일 오름차순, 상시 모집은 마지막, 같으면 ID. 개수 제한 없음

## 근거

`docs/reference/spec/platform.md:121`

> - **지원금 추천**(`/recommend/grant`, `requiresMenuAccess:false`): 좌 `전체 지원금`(현재 신청 가능), 우 `맞춤 추천`(회사 **업종·지역** 매칭, 최대 15개, 업종 불명확하면 업종 무제한). 노출 = 신청 시작 ≤ 오늘 ≤ 마감 또는 상시모집. **매일 04:00 갱신**. 업종 데이터: remittance `GET /api/company/:id/get-business_types`, `POST /update-business_types`(B:89485-89488) 가 후보.

`manual/02-홈-Universal-Home/06-지원금-추천.md`

> 전체 지원금 중 우리 회사에 맞는 지원금만 골라 보여줍니다. 조회 중인 회사의 **업종**과 **지역** 정보에 맞는 지원금이 추천되며, 최대 15개까지 표시됩니다. 업종이 명확히 분류되지 않는 경우에는 특정 업종에 한정하지 않고 추천합니다.
>
> - 신청이 시작된 지원금이 목록에 나타납니다.
> - 신청이 마감된 지원금은 목록에서 제외됩니다.
> - 상시 모집하는 지원금은 등록된 시점부터 계속 표시됩니다.
>
> 목록은 매일 새벽 4시에 갱신됩니다.

`apps/api/legacy/src/modules/platform/assistant/assistant.service.ts:145-161` (발췌)

```ts
'SELECT … FROM grants WHERE apply_end_on IS NULL OR apply_end_on >= ? ORDER BY apply_end_on IS NULL, apply_end_on, id'
const regionOk = regions.length === 0 || (region !== null && regions.includes(region))
const industryOk = codes.length === 0 || codes.some((code) => industries.has(code))
```

## 픽스처

[`apps/api/test/fixtures/rules/grant-recommendation.json`](../../../apps/api/test/fixtures/rules/grant-recommendation.json): 14건 (추적 14)

| 케이스 | 입력 | 결과 |
|---|---|---|
| 신청 중 / 오늘 마감 / 상시 | | 표시 |
| 마감 / 시작 전 | | 제외 |
| 업종·지역 일치 | 3건 중 | 1건 |
| 전국·업종 무제한 공고 | | 모든 회사에 추천 |
| 업종 불명확 회사 | 업종 제한 공고 | 추천 (매뉴얼) / 제외 (레거시) |
| 20건 일치 | | 15건 |
| 레거시, 시작 전 공고 | | 추천됨 |
| 레거시, 지역 없는 회사 | 지역 제한 공고 | 제외 |
| 레거시 정렬 | | 마감 임박순, 상시는 마지막 |

## 서버 이전 시 주의

- 시작일 확인과 15개 상한, 업종 불명확 처리는 매뉴얼을 따릅니다. 레거시 동작은 버그로 봅니다
- 15개를 고르는 순서(점수)가 매뉴얼에 없습니다. "AI가 골라" 준다는 표현만 있습니다. 결정 전까지 마감 임박순으로 둡니다
- 회사 업종·지역의 출처를 정해야 합니다. 지역은 회사 주소에서, 업종은 홈택스 업종 코드에서 파생하는 안이 있습니다 ([integrations.md](../../design/integrations.md))
- 04:00 갱신은 공고 수집 작업과 추천 계산 작업을 함께 돌리는 스케줄입니다. "오늘" 판정은 회사 시간대(`Asia/Seoul`)로 합니다

