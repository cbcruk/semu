# 자동분류 적용 모드

## 요약

- 맞은 규칙이 행에 쓸 값을 정합니다. 결과는 계정과목 그리고/또는 거래처입니다
- `FILL_EMPTY`는 비어 있는 계정과목·거래처만 채우고, `OVERWRITE`는 둘 다 덮습니다
- `OVERWRITE`도 사람이 직접 분류한(`MANUAL`) 행은 건너뜁니다

## 현행 위치

- `apps/api/legacy/src/modules/bookkeeping/classification/classification.utils.ts:15-20, 82-102` (`planRuleUpdate`)
- 일괄 적용: `apps/api/legacy/src/modules/bookkeeping/classification/classification.service.ts`

## 로직

- `OVERWRITE`이고 행이 `MANUAL`이면 아무것도 바꾸지 않습니다
- 계정과목: 결과가 있고, (`OVERWRITE` 또는 행이 미분류)이고, (다른 계정이거나 지금 분류가 규칙 분류가 아니면) 씁니다
- 거래처: 결과가 있고, (`OVERWRITE` 또는 행 거래처가 비어 있음)이고, 지금과 다르면 씁니다
- 바꿀 것이 없으면 `null`이고 갱신 건수에 넣지 않습니다
- 새로 수집한 행에는 `FILL_EMPTY`로 자동 적용합니다

## 근거

- 매뉴얼 `alfred-manual/03-경리/01-매출-증빙-관리/01-경리-규칙기반-자동분류.md:35-36`
  > **빈 항목만 채우기**: 아직 분류되지 않은 이전 거래에 적용
  >
  > **입력된 항목도 덮어쓰기**: 모든 이전 거래에 적용
- 스펙 `docs/reference/spec/bookkeeping.md:183`
  > `overwrite` (입력된 항목도 덮어쓰기): 모든 거래 대상. 단 `classified_by='manual'`도 덮어쓰는지는 미확인입니다.

## 서버 이전 시 주의

- 매뉴얼은 "모든 이전 거래"라고 합니다. 사람이 고친 분류를 건너뛰는 것은 현행 서버의 선택(`OVERWRITE_KEEPS_MANUAL = true`)입니다
- `FILL_EMPTY`는 계정과목이 있는 행에도 비어 있는 거래처는 채웁니다. 매뉴얼 문구("분류되지 않은 거래")보다 넓습니다
- 현행 일괄 적용은 동기 처리입니다. 재설계는 `202` + Job을 돌려주지만 지금은 바로 `SUCCEEDED`입니다

## 픽스처

`apps/api/test/fixtures/rules/classification-apply-mode.json` (7케이스)
