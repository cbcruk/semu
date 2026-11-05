# 실시간 손익 집계

## 요약

- 분류된 증빙과 입출금을 계정과목의 손익 구분(`plCategory`)으로 월별 손익 줄에 넣습니다
- 거래대금·잔액 이동 계정(`NONE`)은 넣지 않아 매출 증빙과 그 대금 입금이 두 번 잡히지 않습니다
- 증빙은 공급가액(정책에 따라 합계), 입출금은 정책이 넣을 때만 셉니다. 미분류는 건수만 셉니다

## 현행 위치

- `apps/api/legacy/src/modules/bookkeeping/realtime-reports/realtime-reports.service.ts:53-119`
- `apps/api/legacy/src/modules/bookkeeping/realtime-reports/realtime-reports.utils.ts:8-181`
- 정책: `apps/api/legacy/src/modules/bookkeeping/settings/bookkeeping-settings.ts`

## 로직

- 증빙은 작성일자의 달에 넣습니다. 매출 증빙은 수익 쪽(+), 매입 증빙은 비용 쪽(+)
- 입출금: 입금은 수익 쪽, 출금은 비용 쪽입니다. 출금 −8,000,000을 판관비로 분류하면 판관비 8,000,000입니다
- 줄: 매출, 매출원가, 판관비, 영업외수익, 영업외비용, 법인세등. 줄 아래는 2단계 보고서 계정별 금액입니다
- `매출총이익 = 매출 − 매출원가`, `영업이익 = 매출총이익 − 판관비`, `순이익 = 영업이익 + 영업외수익 − 영업외비용 − 법인세등`
- 누계 보기는 1월부터 그달까지 더합니다
- 홈 요약의 비용은 `매출원가 + 판관비 + 영업외비용`입니다

## 근거

- 스펙 `docs/reference/spec/bookkeeping.md:622-638`
  > '거래대금' 그룹(매출대금 입금·매입대금 출금 등, pl_category='none')은 손익 제외 → 증빙과 입금이 이중 계상되지 않음
  >
  > 미분류 건은 집계에서 뺍니다. 매뉴얼의 "분류 완료된 경우에만 조회"가 근거입니다.

## 서버 이전 시 주의

- 기본 정책은 공급가액, 입출금 포함입니다. 현행은 `bookkeeping_settings`에서 회사별 값을 읽지만 바꾸는 엔드포인트가 없어 재설계도 기본값만 씁니다
- 증빙이 있는 비용을 입출금으로도 손익 계정에 분류하면 두 번 잡힙니다. 막지 않습니다
- 데모 2026-10 손익(매출 44,000,000, 순이익 23,030,000)이 현행과 같게 나옵니다(`reports.http.test.ts`)

## 픽스처

`apps/api/test/fixtures/rules/realtime-pl-inclusion.json` (7케이스)
