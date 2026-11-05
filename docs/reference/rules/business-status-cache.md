# 사업자 상태조회 캐시

## 요약

- 국세청 사업자 상태조회 결과를 사업자번호별로 캐시하고, 조회한 날에만 다시 씁니다(TTL 1일)
- 시각이 아니라 날짜로 비교합니다. 23:59에 조회한 결과도 다음 날 0시에 만료됩니다

## 현행 위치

- `apps/api/legacy/src/modules/bookkeeping/partners/partners.service.ts:39` (`BUSINESS_STATUS_TTL_DAYS = 1`)
- `apps/api/legacy/src/modules/bookkeeping/partners/partners.service.ts:219-231` (`lookupBusinessStatus`)

## 로직

- `조회일 + 1일 > 오늘`이면 캐시를 씁니다
- 아니면 국세청(포트 `BusinessStatusLookup`)에 묻고 캐시를 바꿉니다
- 현행 조회일은 `checked_at.slice(0, 10)`, 즉 UTC 날짜입니다

## 근거

- 매뉴얼 `alfred-manual/03-경리/05-거래처-관리.md:29`
  > **사업자 등록번호** `*` : 사업자·개인 여부에 따라 입력. `조회하기`로 정상·휴폐업 여부를 확인할 수 있습니다.
- 스펙 `docs/reference/spec/bookkeeping.md:945`
  > 국세청 사업자 상태 | in | `partner/scrap/business-status` 프록시와 캐시

## 서버 이전 시 주의

- UTC 날짜로 비교하면 한국 시간 0~9시에 조회한 결과가 같은 날 9시 전후로 만료가 갈립니다. 재설계는 회사 시간대 날짜로 비교합니다
- 현행 조회는 같은 사업자번호 거래처의 `business_status`도 고쳤습니다. 재설계 `GET /business-statuses/{businessNumber}`는 읽기 전용이라 아직 고치지 않습니다

## 픽스처

`apps/api/test/fixtures/rules/business-status-cache.json` (4케이스, 1케이스 바꿈)
