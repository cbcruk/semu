# 계정과목 제약

## 요약

- 거래는 적용 범위(매출·매입·입금·출금)가 맞고 하위 계정이 없는 2·3단계 계정으로만 분류합니다
- 하위 계정이 없던 2단계 계정에 분류된 거래가 있으면, 첫 하위 계정을 추가할 때 `기타 {상위명}`을 자동으로 만들고 거래를 옮깁니다
- 기본 계정은 지울 수 없고, 분류된 거래가 있는 계정은 옮길 계정을 받아야 지웁니다

## 현행 위치

- `apps/api/legacy/src/modules/bookkeeping/account-titles/account-titles.utils.ts:10-40`
- `apps/api/legacy/src/modules/bookkeeping/account-titles/account-titles.service.ts:35-166`
- 기본 체계: `apps/api/legacy/src/db/migrations/0040-bookkeeping.sql`

## 로직

- 분류 가능 검사(순서대로): 없는 계정 `UNKNOWN` → 범위 밖 `SCOPE_MISMATCH` → 1단계이거나 하위가 있음 `NOT_SELECTABLE`
- 하위 계정 추가
  - 3단계 아래는 `DEPTH_EXCEEDED`
  - `createAutoEtc = 형제 없음 && 상위가 2단계 && 상위에 분류된 거래 > 0`
  - 같은 상위 아래 같은 이름(만들 `기타` 포함)은 `NAME_DUPLICATE`
  - 1단계 아래면 2단계, 2단계 아래면 3단계가 됩니다
- 삭제(순서대로): 기본 계정 `SYSTEM_LOCKED` → 하위 있음 `HAS_CHILDREN` → 분류된 거래가 있는데 옮길 계정 없음 `MOVE_TARGET_REQUIRED` → 옮길 계정이 자기 자신이거나 선택 불가 `MOVE_TARGET_INVALID`
- 지울 때 그 계정을 결과로 쓰는 자동분류 규칙도 옮길 계정으로 바꿉니다

## 근거

- 매뉴얼 `manual/08-설정/04-경리-설정.md:52`
  > 상위 계정과목 아래에 기존 거래가 있는 상태에서 신규 계정과목을 처음 추가하면, `기타 {상위 계정과목명}` 신규 계정과목이 자동으로 생성되고 기존 거래의 계정과목이 그쪽으로 자동 이관됩니다.
- 스펙 `docs/reference/spec/bookkeeping.md:165`
  > 하위 계정이 생긴 2차 계정은 더 이상 직접 선택할 수 없다고 추정합니다. "기타" 자동 생성이 그 근거입니다.

## 서버 이전 시 주의

- 기본 계정 54행은 현행 마이그레이션의 추정 체계입니다. 재설계는 코드(`system-account-titles.ts`)로 들고 ID를 `acc_` + 정렬 순서로 고정합니다
- 옮길 계정의 적용 범위는 현행도 검사하지 않습니다
- `기타` 생성과 거래 이관은 한 트랜잭션입니다

## 픽스처

`apps/api/test/fixtures/rules/account-title-constraints.json` (16케이스)
