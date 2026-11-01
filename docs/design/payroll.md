# 급여 도메인 설계 (1부: 계산 엔진, 기준표, 급여 설정 · 2부: 급여대장, 명세서, 퇴직금, 원천세 연계)

> 상태: v0.2 · 2026-11-01 · 구현: `apps/api/src/modules/payroll/**`, 마이그레이션 `0030-payroll-settings.sql`, `0031-payroll-cards.sql`
>
> 근거는 [`spec-notes/payroll.md`](../spec-notes/payroll.md)(이하 "스펙")이고, 공통 규약은 [`api-architecture.md`](../api-architecture.md)를 따릅니다. 2부(급여대장·BPO 흐름·명세서·퇴직금 정산)는 9절부터입니다.

## 1. 범위와 구조

| 폴더 | 내용 | DB |
| --- | --- | --- |
| `engine/` | 순수 계산 함수. 4대보험, 간이세액, 일용·사업·기타 원천징수, 비과세 한도, 근로시간·가산수당·일할, 퇴직금·퇴직소득세, 행 단위 진입점 | 없음 |
| `reference/` | 기준표 저장소(`payroll_rate_tables`), 참조 코드(업종·지급사유·국가), 급여계산기, 엑셀(CSV) 양식 | `payroll_rate_tables` |
| `settings/` | `employment/settings/*` 27개 엔드포인트 | `payroll_terms`, `payroll_deduction_settings`, `payroll_payment_items`, `payroll_deduction_items`, `work_conditions`, `work_schedule_policies` |

- 엔진은 직원 테이블을 모릅니다. 호출하는 쪽이 HR 조회 결과를 평범한 객체로 바꿔 넘깁니다.
- 엔진의 공개 API는 `engine/index.ts` 한 곳에서 내보냅니다.

## 2. 엔진 설계

### 2.1 값의 단위

| 값 | 표현 | 이유 |
| --- | --- | --- |
| 금액 | 원 단위 정수 | `lib/money` 규약 |
| 요율 | ppm 정수(1% = 10,000) | 3.595%, 13.14%를 정확히 담기 위해서입니다. bp(만분율)로는 3.595%를 표현할 수 없습니다 |
| 곱셈·나눗셈 | `mulDiv(a, b, c) = floor(a × b ÷ c)`를 BigInt로 계산 | 큰 금액 × 요율에서 정밀도를 잃지 않기 위해서입니다 |
| 시간 | 입력은 소수 시간, 내부는 분 정수 | 1.5시간 같은 값을 부동소수 오차 없이 계산합니다 |
| 배수 | 입력은 소수(1.5), 내부는 100분율 정수, DB는 `*_x100` 열 | |
| 시급 | `WageRate {amount, perMinutes}` | 통상시급을 반올림하지 않고 가산수당을 계산합니다(월 통상임금 ÷ 209시간을 끝까지 분수로 유지) |

### 2.2 반올림 규칙

모든 중간 단계는 **원 미만 절사**입니다. 아래 표는 최종 금액에 적용하는 단위이고, 단위 자체도 기준표 값이라 바꿀 수 있습니다.

| 항목 | 규칙 | 기준표 키 | 확인 |
| --- | --- | --- | --- |
| 국민연금 기준소득월액 | 하한·상한으로 자른 뒤 **천원 미만 절사** | `nationalPension.baseRoundingUnit` | 미확인 |
| 국민연금 보험료 | 기준소득월액 × 4.75%, **10원 미만 절사** | `nationalPension.premiumRoundingUnit` | 미확인 |
| 건강보험료 | 보수월액 × 3.595%, 10원 미만 절사 | `healthInsurance.premiumRoundingUnit` | 미확인 |
| 장기요양보험료 | 건강보험료(각 측) × 13.14%, 10원 미만 절사 | `longTermCare.premiumRoundingUnit` | 미확인 |
| 고용보험료 | 보수 × 0.9%(사업주는 + 고용안정 0.25%), 10원 미만 절사 | `employmentInsurance.premiumRoundingUnit` | 미확인 |
| 근로소득세(간이세액) | 연 결정세액 ÷ 12 → **10원 미만 절사** → 자녀공제 차감 → 감면 → × 80/100/120% → 10원 미만 절사 | `wageIncomeTax.taxRoundingUnit` | 미확인. 스펙 4.2는 "원 미만 절사"라고 적었지만 국고금 관리법의 10원 미만 절사 관행을 택했습니다 |
| 지방소득세 | 소득세 × 10%, 10원 미만 절사 | `localIncomeTax.roundingUnit` | 미확인(스펙과 같은 이유) |
| 일용·사업·기타 소득세 | 산출 후 10원 미만 절사, 1,000원 미만이면 0(소액부징수) | `smallAmountExemption` | 소액부징수 기준은 확인 |
| 가산수당·일할 | `mulDiv`로 원 미만 절사 | — | |
| 퇴직금 | 평균임금을 분수로 둔 채 `3개월 임금 × 30 × 재직일수 ÷ (역일수 × 365)`를 한 번에 절사. 표시용 평균임금(일)은 원 미만 절사 | — | 실무는 평균임금을 소수 둘째 자리까지 쓰기도 합니다 |
| 퇴직소득세 | 각 단계 원 미만 절사, 최종 10원 미만 절사 | — | 미확인 |

### 2.3 계산 순서

**근로(월급·시급·일급)** `calculateWageRow`

1. 기본급: 월급은 `basePay`(일할이면 `prorate`), 시급은 `시급 × 근무시간`, 일급은 `일급 × 일수`
2. 주휴수당(시급·일급만): `시급 × 1일 주휴시간 × 개근 주 수`. 월급제는 209시간에 이미 들어 있습니다
3. 가산수당: `통상시급 × 시간 × 배수`. 통상시급은 (기본급 + 통상임금 포함 항목, 일할 전 금액) ÷ 월 소정근로시간입니다. 배수는 `payroll_terms`에서 옵니다
4. 근태공제(월급만): `(지각·조퇴·결근 시간 + 주휴공제 일수 × 1일 주휴시간) × 통상시급`을 음수 지급 행으로 넣습니다
5. 지급 항목(일할 대상이면 일할)
6. 비과세 한도 적용(카테고리별 한도를 항목 순서대로 소진, 초과분은 과세)
7. 4대보험(과세 급여 기준, 항목별 `rate | notice | exempt`)
8. 간이세액·지방소득세
9. 회사 공제 항목
10. 최저임금 경고: (기본급 + 최저임금 포함 항목) ÷ 소정근로시간 < 최저시급이면 `BELOW_MINIMUM_WAGE`(차단하지 않음)

**일용** `calculateDailyWorkerRow`: 일별 `max(0, 일급 − 150,000) × 6% − 55%` 합계. 일별 금액을 주지 않으면 총액을 균등 분할합니다. 소액부징수는 **지급 행 단위**로 판정합니다. 고용보험은 설정대로, 국민연금·건강보험은 호출자가 켤 때만 계산하고 8일·60시간 기준을 넘는데 꺼져 있으면 경고합니다.

**사업** `calculateBusinessRow`: 3%(+ 지방 0.3%). `after_tax`면 `grossUpFromNet`으로 역산합니다(967,000 → 1,000,000). 예술인·노무제공자 고용보험은 0.8%입니다.

**기타** `calculateOtherIncomeRow`: `기타소득금액 = 지급액 − 필요경비`, 5만원 이하면 과세최저한, 아니면 20%(지급사유별 세율 가능). 결과의 `taxablePay`는 기타소득금액입니다.

### 2.4 간이세액: 산식, 구간, 교체 가능성

산식(`annualSimpleTaxSteps`): 월 과세급여 × 12 → 근로소득공제(2천만원 한도) → 인적공제 150만원 × 공제대상가족 → 연금보험료공제(국민연금 근로자 요율 × 상하한 적용 월급 × 12) → 특별소득공제 추정(가족 수 1/2/3+ 구간식) → 기본세율 → 근로소득세액공제와 한도 → ÷ 12. 월 1천만원 초과는 "1천만원 세액 + 초과분 산식"입니다. 자녀세액공제(8~20세 1명 12,500원, 2명 29,160원, 3명 이상 1명당 25,000원 추가)를 뺀 뒤 원천징수 비율을 곱합니다.

| 전략 | 동작 | 용도 |
| --- | --- | --- |
| `MIDPOINT_FORMULA`(기본값) | 급여가 속한 간이세액표 행(77만~150만 5천원, ~300만 1만원, ~1천만 2만원 폭)의 **중간값**으로 산식을 계산 | 공식 표가 만들어지는 방식과 같습니다 |
| `EXACT_FORMULA` | 실제 급여로 계산 | 테스트, 설명 |
| `lookupSimpleTaxTable(rows, fallback)` | 공식 표 행을 그대로 조회하고 범위 밖은 fallback | **공식 간이세액표를 넣으면 이것으로 바꿉니다** |

예상 차이:

- 구간 효과: `EXACT`와 `MIDPOINT`의 차이는 행 폭 절반(2,500~10,000원)의 급여에 대한 세액, 즉 수백 원 이내입니다. 300만원·1인: exact 59,080원, midpoint 60,380원.
- 계수 효과: 특별소득공제 추정 산식과 계수는 기억에 의존했습니다(미확인). 기억하는 공식 표 값(300만원·1인 74,350원, 이것도 미확인)과 midpoint 결과(60,380원)가 **약 1만 4천원 차이**가 납니다. 산식 계수가 틀렸거나 기억한 표 값이 틀렸을 수 있습니다. 공식 표를 `lookupSimpleTaxTable`로 넣기 전까지 근로소득세는 **추정치**로 다뤄야 합니다. `/api/tax-rates/simple` 응답에도 `verified: false`를 붙였습니다.

### 2.5 기준표 (`PayrollRateTable`)

- 연도·월별 버전입니다. `effectiveFrom`(`YYYY-MM`)이 귀속월 이하인 것 중 가장 최근 것을 씁니다(`resolveRateTable`).
- TS 상수(`RATES_2026_01`, `RATES_2026_07`)가 원본이고, 앱 시작과 시드 때 `payroll_rate_tables`에 `INSERT OR IGNORE`로 넣습니다. 이미 있는 행은 덮어쓰지 않으므로 운영자가 DB에서 고칠 수 있습니다. API는 DB에서 읽습니다.
- 모든 값에 `verification[경로] = {verified, source}`가 있습니다. `verified: true`는 스펙이나 화면으로 확인된 값만입니다. `unverifiedRatePaths(table)`로 목록을 뽑을 수 있습니다.
- 2026-07 버전은 국민연금 상하한 변경 자리입니다. 값은 아직 몰라서 1월 값을 반복하고 미확인으로 표시했습니다.

| 경로 | 2026 값 | 확인 | 출처 |
| --- | --- | --- | --- |
| `minimumWage` | 시급 10,320 / 월 2,156,880 / 209시간 | ✓ | 스펙 2.9, 화면 3b9f629f |
| `nationalPension.employeeRatePpm` / `employerRatePpm` | 4.75% / 4.75% | ✓ | 스펙 4.1 |
| `nationalPension.baseMin` / `baseMax` | 400,000 / 6,370,000 | ✗ | 2025.7~2026.6 값. 2026.7 이후 미확인 |
| `healthInsurance` | 3.595% / 3.595% | ✓ | 스펙 4.1 |
| `longTermCare.ratioOfHealthPpm` | 13.14% | ✗ | 스펙 "확인 필요" |
| `employmentInsurance.employeeRatePpm` | 0.9% | ✓ | 스펙 4.1 |
| `employmentInsurance.employerUnemploymentRatePpm` | 0.9% | ✗ | 법령 기억 |
| `employmentInsurance.employerStabilityRatePpm` | 0.25%(150인 미만) | ✗ | 규모별로 다름. 호출자가 덮어쓸 수 있음 |
| `employmentInsurance.artistEmployeeRatePpm` | 0.8% | ✗ | 스펙 "확인 필요" |
| `industrialAccident.defaultEmployerRatePpm` | 0 | ✗ | 업종별. 호출자가 회사 요율을 넘김 |
| 각 보험 반올림 단위 | 10원(기준소득월액 1,000원) | ✗ | 2.2절 |
| `wageIncomeTax.earnedIncomeDeduction`, `Cap` | 70/40/15/5/2%, 2천만원 | ✗ | 소득세법 47조 기억 |
| `wageIncomeTax.personalDeductionPerDependant` | 1,500,000 | ✗ | 50조 기억 |
| `wageIncomeTax.specialDeductionByDependants` | 1명 310만+4%…, 2명 360만+4%…, 3명+ 500만+7%… | ✗ | 별표2 기억, **신뢰도 낮음** |
| `wageIncomeTax.brackets` | 6/15/24/35/38/40/42/45% (1,400만·5,000만·8,800만…) | ✗ | 55조(2023 개정) 기억 |
| `wageIncomeTax.earnedIncomeCredit`, `Limits` | 55%, 130만 초과 715,000+30% / 한도 74만·66만·50만·20만 | ✗ | 59조 기억 |
| `wageIncomeTax.childCreditMonthly` | 12,500 / 29,160 / +25,000 | ✗ | 2024 간이세액표 기억 |
| `wageIncomeTax.highIncomeBrackets` | 1천만 초과 98%×35%+25,000 … 8,700만 초과 45% | ✗ | 별표2 기억(경계값끼리 일관됨을 확인) |
| `wageIncomeTax.tableRowBands`, `tableMinimumPay` | 5천/1만/2만원 폭, 77만원부터 | ✗ | 별표2 기억 |
| `wageIncomeTax.taxRoundingUnit` | 10원 | ✗ | 2.2절 |
| `localIncomeTax.ratePpm` | 10% | ✓ | 스펙 4.2 |
| `dailyWorker` | 15만원 공제, 6%, 55%, 8일·60시간 | ✓ | 스펙 4.3, 4.1 |
| `businessIncome.ratePpm` | 3% | ✓ | 스펙 4.4 |
| `otherIncome` | 20%, 과세최저한 5만원 | ✓ | 스펙 4.5 |
| `smallAmountExemption` | 1,000원 | ✓ | 스펙 4.3·4.4 |
| `nonTaxable.meal/vehicle/childcare/research` | 월 200,000 | ✓ | 스펙 4.6 |
| `nonTaxable.overseas` / `overseas_special` | 월 1,000,000 / 5,000,000 | ✗ | 스펙 "확인 필요" |
| `nonTaxable.night_shift` | 연 2,400,000 | ✗ | 월정액급여 요건은 엔진 밖 |
| `nonTaxable.parental_leave`, `tuition` | 한도 없음 | ✗ | |
| `nonTaxable.invention` | 연 7,000,000 | ✗ | |
| `retirementIncomeTax.serviceYearDeduction` | 5년 이하 100만×년, 10년 이하 500만+200만…, 20년 이하 1,500만+250만…, 초과 4,000만+300만… | ✗ | 2023 개정 기억 |
| `retirementIncomeTax.convertedPayDeduction` | 800만 100%, 7천만 60%, 1억 55%, 3억 45%, 초과 35% | ✗ | 기억 |

참조 코드(`reference-data.ts`)도 `verified`를 가집니다. 사업소득 업종명 중 화면에 나온 것(기타자영업(프리랜서), 가수, 간병인, 기타모집수당)은 이름만 확인했고, **숫자 코드는 전부 미확인**입니다. 특고 직종코드와 기타소득 지급사유 코드·세율(연금해지 15%, 서화·골동품 80%)도 미확인입니다.

## 3. 다음 담당자가 쓸 엔진 API

```ts
import {
  calculatePayrollRow, resolveRateTable, calculateSeverancePay, calculateSocialInsurance,
  calculateWageIncomeTax, splitNonTaxable, weeklyRestHours, monthlyStandardHours,
  MIDPOINT_FORMULA, EXACT_FORMULA, lookupSimpleTaxTable,
  MULTIPLIERS_FIVE_OR_MORE, MULTIPLIERS_UNDER_FIVE,
} from '../payroll/engine'
import { rateTableFor } from '../payroll/reference/rate-tables.repository'

calculatePayrollRow(input: PayrollRowInput, rates: PayrollRateTable, options?: { simpleTax?: SimpleTaxStrategy }): PayrollRowResult
calculateWageRow(input: WageRowInput, rates, options?): PayrollRowResult
calculateDailyWorkerRow(input: DailyWorkerRowInput, rates): PayrollRowResult
calculateBusinessRow(input: BusinessRowInput, rates): PayrollRowResult
calculateOtherIncomeRow(input: OtherIncomeRowInput, rates): PayrollRowResult
calculateSeverancePay(input: SeveranceInput, rates): SeveranceResult
resolveRateTable(tables, 'YYYY-MM'): PayrollRateTable      // 순수
rateTableFor(db, 'YYYY-MM'): PayrollRateTable               // DB에서 읽기
```

- `PayrollRowInput`은 `incomeType`(`wage_monthly | wage_hourly | wage_daily | daily | business | other`)로 구분되는 유니온입니다. BPO 세그먼트(`wage-monthly` 등)의 하이픈을 밑줄로 바꾼 값입니다.
- 근로 행 입력의 출처:
  - `paymentItems`: `payroll_payment_items` + 카드 금액. `nonTaxableCategory`, `includeInOrdinaryWage`, `includeInMinimumWage`, 회사 한도(`companyNonTaxableLimit`)를 설정 행에서 옮깁니다
  - `multipliers`: `payroll_terms.fixed_*_multiplier`
  - `monthlyStandardHours`, `dailyRestHours`: 근로시간 정책 응답의 `monthly_standard_hours`, `weekly_rest_hours`
  - `insurance.*.mode`: `payroll_deduction_settings`의 `notice | rate`, 직원 4대보험 제외 사유면 `exempt`
  - `incomeTax`: 회사 `income_tax_method`와 HR `deduction-info`(가족 수, 자녀 수, 80/100/120%)
- `PayrollRowResult`는 `payments[]`, `deductions[]`(fx 근거 `formula` 포함), `grossPay`, `taxablePay`, `nonTaxablePay`, `insurance.{employee,employer}`, `incomeTax`, `localIncomeTax`, `deductionTotal`, `netPay`, `employerInsuranceTotal`, `breakdown[]`, `warnings[]`, `rateTable`(사용한 기준표 월)입니다. `calc_trace` JSON에는 `breakdown`을 그대로 저장하면 됩니다.
- 기준표 조회 월: 4대보험은 귀속월, 원천세는 지급일 기준이 원칙입니다(스펙 4.13, 확인 필요). 지금 엔진은 행 하나에 표 하나를 받으므로, 둘이 다르면 호출자가 보험과 세금을 따로 계산해야 합니다. 2026년 안에서는 두 버전의 세율이 같아 차이가 없습니다.
- 사용 현황: `payrollRoutes(deps, { usage })`의 `SettingsUsageCounter`(`workConditionUsages`, `workSchedulePolicyUsages`)를 HR 근로계약 조회로 구현해 넘기면 `usage-status`와 삭제 거부가 실제 값으로 동작합니다. 기본값은 `NO_USAGE`(항상 0)입니다. `createApp`은 옵션 없이 부르므로, 연결할 때 `payroll.routes.ts`의 기본값을 바꾸는 편이 간단합니다.
- 설정 기본값: `ensurePayrollSettings(db, companyId, now)`가 회사의 첫 요청(또는 시드) 때 급여 조건, 공제 설정, 기본 지급 항목 7개, 기본 근로조건, "주 5일 40시간" 정책을 만듭니다. 급여대장 쪽에서 설정을 읽기 전에도 이 함수를 부르세요(트랜잭션 안에서 호출하는 것을 전제로 합니다).

## 4. 엔드포인트

### 4.1 회사 경로 `/api/company/:companyId/employment/settings` (메뉴 `payroll_setting`)

| 동사 | 경로 | 비고 |
| --- | --- | --- |
| GET | `/payroll-payment-categories` | `search`, `is_taxable`, `group`. 카탈로그 전체(DRF 봉투, 페이지 없음) |
| GET, POST | `/payroll-payment-items` | `is_taxable`, `search`, `limit`, `offset` |
| GET, PATCH, DELETE | `/payroll-payment-items/:id` | 기본급(`is_system`)은 삭제·이름 변경 불가 |
| GET, PATCH | `/payroll-deduction` | 회사 싱글턴 |
| GET, POST | `/payroll-deduction-items` | |
| GET, PATCH, DELETE | `/payroll-deduction-items/:id` | |
| GET, PATCH | `/payroll-terms` | 응답에 읽기 전용 `minimum_wage` |
| GET, POST | `/work-conditions` | `is_active` 필터 |
| GET, PATCH, DELETE | `/work-conditions/:id` | 사용 중이면 삭제 409 |
| GET, PATCH | `/work-conditions/:id/usage-status` | PATCH `{is_active}` |
| GET, POST | `/work-schedule-policies` | |
| GET, PUT, DELETE | `/work-schedule-policies/:id` | PUT은 전체 교체 |
| GET, PATCH | `/work-schedule-policies/:id/usage-status` | |

스펙 5.10의 27개(동사 기준)에 `usage-status` GET 2개를 더했습니다.

### 4.2 계정 경로 (인증 필요, 회사 경로 아님)

| 동사 | 경로 | 비고 |
| --- | --- | --- |
| GET | `/api/payroll/business-income-types` | `target_date=YYYYMM`(기본: 이번 달) |
| GET | `/api/payroll/special-occ-types` | |
| GET | `/api/payroll/other-labor-income-types` | |
| GET | `/api/payroll/nation-codes` | |
| GET, POST | `/api/payroll/excel` | CSV 양식 / CSV 업로드 파싱(저장하지 않음) |
| GET | `/api/tax-rates/simple` | `monthly_pay`가 있으면 단건, 없으면 생성한 표 전체 |
| GET | `/api/tax-rates/necessary-expenses` | |
| POST | `/api/payroll/calculator/simulate` | 저장하지 않음. snake_case 그대로 응답 |

참조·계산기 경로는 번들에서 세션으로 부르고 회사 ID가 없어서 `account` 라우터에 두었습니다. 공개(`public`)로 열 근거는 찾지 못했습니다.

## 5. 설정 결정 사항

- **지급 항목 규칙**: 비과세 항목은 카탈로그에서만 만들 수 있고 표준 이름을 바꿀 수 없습니다. 연차수당도 표준 이름 필수입니다. 직접 입력 항목은 과세만 됩니다. 카탈로그 항목의 과세 여부는 카탈로그와 같아야 합니다. 비과세 한도는 비과세 항목에만 켤 수 있고 법정 월 한도를 넘을 수 없습니다(엔진은 회사 한도와 법정 한도 중 작은 값을 씁니다). 계산방법 표기를 켜면 계산방법이 필수입니다. 이름은 회사 안에서 유일합니다.
- **기본 지급 항목**: 기본급(시스템), 연장·야간·휴일·휴일연장근로수당, 연차수당, 식대. 카탈로그의 포함 플래그 기본값(월급여·통상·평균·최저)은 항목 성격에 따른 제안입니다.
- **공제 설정**: 스펙은 국민연금 산출방법에 `notice`만 적었지만 엔진이 요율 계산을 지원하므로 `notice | rate`를 모두 받습니다. 기본값은 국민연금·건강보험 `notice`, 고용보험 `rate`, 소득세 `tax_table_based`입니다.
- **급여 조건**: 5인 미만 여부를 바꾸면서 배수를 함께 보내지 않으면 배수를 새 규모의 기본값으로 되돌립니다. 배수는 소수 둘째 자리까지 받습니다. 기본 급여일은 25일(추정)입니다.
- **근로조건**: 수습 개월이 0이면 수습 급여 비율을 100%로 맞춥니다.
- **근로시간 정책**: 주기 안의 요일별 시간(`{week, day_of_week, hours}`)으로 받습니다. 주 소정근로시간은 주기 평균, 월 단위 주기는 정의한 주 수로 나눕니다. 자동 주휴시간은 비례식(`주 소정 ÷ 40 × 8`, 최대 8)이고, 주 15시간 미만이면 0입니다. 응답에 `weekly_contractual_hours`, `work_days_per_week`, `weekly_rest_hours`, `monthly_standard_hours`를 붙입니다. 같은 요일이 유급·무급 휴일에 동시에 있거나, 휴일에 소정 시간이 있거나, 주 15시간 이상인데 유급주휴일이 없으면 422입니다. 고정 시간외는 `none`끼리 짝이 맞아야 하고, 요일별일 때만 요일을 받습니다.
- **ID**: sf와 같이 정수 자동 증가 ID입니다.
- **사용 중 삭제**: `INVALID_TRANSITION`(409)으로 거부하고 비활성화를 권합니다. 오류 코드 목록이 공통 소유라 새 코드를 만들지 않았습니다.

## 6. 추정 응답

| 엔드포인트 | 추정한 형태 | 근거 |
| --- | --- | --- |
| `payroll-payment-categories` | `{count, next: null, previous: null, results: [{code, name, group, is_taxable, non_taxable_category, statutory_monthly_limit, statutory_annual_limit, description, standard_name_required, include_in_*}]}` | 불러오기 모달 열(항목명/과세여부/설명), 6절 3순위 |
| `payroll-payment-items[/:id]` | 스펙 2.4 필드 + `non_taxable_category`, `statutory_non_taxable_limit`, `is_system`, `sort_order` | 스펙 2.4 |
| `payroll-deduction` | `{national_pension_method, national_pension_pay_on_acquisition_month, health_insurance_method, employment_insurance_method, income_tax_method, updated_at}` 평탄 구조 | 스펙 2.5 |
| `payroll-deduction-items` | `{id, name, amount_mode, amount}` | 스펙 2.5 |
| `payroll-terms` | 스펙 2.9 필드 + `minimum_wage: {year, hourly_wage, monthly_wage, monthly_hours}` | 화면 3b9f629f |
| `work-conditions` | `{id, name, work_place, probation_months, probation_pay_rate, is_active}` | 스펙 2.9 |
| `*/usage-status` GET | `{id, is_active, usage_count, in_use}` | 엔드포인트 이름 |
| `*/usage-status` PATCH | 엔티티 + 위 필드 | |
| `work-schedule-policies` | 2.9 필드(`contractual_work_schedules[]`, `fixed_overtime_items[]`) + 파생 시간 | 번들 상수, 화면 c7509102 |
| `business-income-types` | `[{code, name, detail_type, verified}]` 평탄 배열 | 스펙 5.1 #25 |
| `special-occ-types` | `[{code, name, verified}]` | #26 |
| `other-labor-income-types` | `[{code, name, necessary_expense_rate(%), tax_rate(%), verified}]` | #27 |
| `nation-codes` | `[{code(ISO alpha-2), name}]` | #28 |
| `excel` GET | CSV(UTF-8 BOM), 파일명 `혜움_급여입력_양식.csv`. 원본은 xlsx지만 의존성 없이 만들 수 없어 CSV로 대신했습니다 | #29 |
| `excel` POST | `{rows: [{row_number, income_type, name, resident_number, is_foreigner, residence_country, payment_date, pay_amount, work_days, business_income_type_code, other_income_type_code}], errors: [{row_number, errors[]}]}` | 스펙 7절(저장하지 않고 그리드에 채움) |
| `tax-rates/simple` | 단건 `{target_date, rate_table, method, verified, monthly_pay, dependants, children, income_tax, local_income_tax}` / 전체 `{…, rows: [{min, max, taxes[11]}]}` | 스펙 8절 8번 미확인 |
| `tax-rates/necessary-expenses` | `[{income_type_code, name, necessary_expense_rate, verified}]` | 이름 |
| `calculator/simulate` 요청 | `{type: wage, monthly_pay, meal_allowance?, non_taxable_pay?, dependants?, children_aged_8_to_20?, withholding_ratio?}` / `{type: daily, daily_pay, work_days?}` / `{type: business, pay_amount, tax_deduction_mode?}` / `{type: other, pay_amount, income_type_code?, necessary_expense_rate?(%), tax_deduction_mode?}`, 공통 `target_date?` | 탭 이름(`SALARY_CALCULATOR_TAB_SEGMENT`) |
| `calculator/simulate` 응답 | `{type, income_type, attribution_month, rate_table, gross_pay, taxable_pay, non_taxable_pay, national_pension, health_insurance, long_term_care_insurance, employment_insurance, income_tax, local_income_tax, deduction_total, net_pay, employer{…, total}, payments[], deductions[], breakdown[], warnings[]}` | 매뉴얼 "급여액 대비 공제금액, 차인지급액" |

## 7. 메뉴

`payroll.menus.ts`에 넣은 규칙입니다. `requiredPlans`는 하나만 있어도 열립니다.

| 코드 | 경로 | `requiredPlans` | 권한 필요 | 근거 |
| --- | --- | --- | --- | --- |
| `payroll_settlement` | `/payroll-settlement` | `['payroll']` | ○ | 스펙 1.1 "급여 구독, 또는 급여 구독과 세무 기장을 함께" |
| `payroll_management` | `/company/payroll` | `['taxation']` | ○ | "세무 기장 고객" |
| `payroll_setting` | `/payroll-setting` | `['payroll']` | ○ | "급여 구독" |
| `salary_calculator` | `/salary-calculator` | `[]` | × | "공통" |

코드는 제안입니다. 번들에는 프로모션 노드 코드 `pb_payroll_management`, `pb_employment`만 있습니다. 세무 약관 게이트(`requiresTaxTerms`)는 모두 끕니다.

`default-menu-tree.ts`(공유 파일, 수정하지 않음)에 추가할 leaf 제안:

```ts
section(5, '급여', 'payroll', [
  group(51, '급여', [
    leaf(511, '급여 정산', 'payroll_settlement', '/payroll-settlement'),
    leaf(512, '급여 관리', 'payroll_management', '/company/payroll'),
    leaf(513, '급여 계산기', 'salary_calculator', '/salary-calculator/wage'),
  ]),
]),
// 설정 > 운영 설정 그룹 아래
leaf(9xx, '급여 설정', 'payroll_setting', '/payroll-setting/conditions-of-employment'),
```

퇴직금 정산(`/severance-pay-settlement`, 메뉴 트리 버전 `2026.08_퇴직금정산`)은 2부에서 `severance_pay_settlement`(급여 구독 추정)로 추가했습니다. 20절을 보세요.

## 8. 미해결 질문

1. 간이세액: 공식 간이세액표(2024 개정 이후, 2026 개정 여부)를 받아 `lookupSimpleTaxTable` 행으로 넣어야 합니다. 그 전까지 근로소득세는 추정치이고, 2.4절의 약 1만 4천원 차이를 확인해야 합니다.
2. 반올림: 소득세·지방소득세를 원 미만 절사(스펙)로 할지 10원 미만 절사(구현)로 할지. 보험료별 절사 단위.
3. 미확인 요율(2.5절 ✗): 장기요양 13.14%, 국민연금 2026.7 상하한, 고용보험 사업주 요율과 규모 구간, 예술인 0.8%와 필요경비 공제, 비과세 한도(국외근로·야간근로·직무발명 등), 퇴직소득 공제표, 업종·지급사유 코드.
4. 4대보험 기준월(귀속월)과 원천세 기준월(지급일)이 다른 대장을 어떻게 계산할지(3절).
5. 주휴시간 방식: 단시간 근로자 비례식(구현 기본값)과 스펙의 "주 소정 ÷ 소정근로일수" 중 무엇을 쓰는지. `weeklyRestHours`가 둘 다 지원합니다.
6. 월 소정근로시간 반올림(104.29 → 104로 반올림). 실무에서 올림이나 소수 유지도 씁니다.
7. 일할계산 방식(역일 / 소정근로일). 엔진은 둘 다 받습니다.
8. 일용 소액부징수를 지급 행 단위로 판정할지 일 단위로 판정할지(구현: 행 단위).
9. 사업소득 "세금공제후" 값 이름과 역산 규칙(구현: `after_tax`, 순액이 같아지는 여러 총액 중 `순액 ÷ 0.967`에 가장 가까운 값).
10. 퇴직금: 평균임금 소수 처리, 3개월 기간의 휴직 제외, 퇴직연금(DB·DC)과 IRP 과세이연은 범위 밖입니다.
11. 메뉴 코드 실제 값과 `payroll_management`에 세무 약관 게이트가 필요한지.
12. `usage-status` GET 응답 형태, `payroll-payment-categories`가 평탄 목록인지 분류 묶음인지.
13. 엑셀 업로드 원본 양식(xlsx) 열 정의. 지금은 CSV로 대신합니다.

---

# 2부: 급여대장, 명세서, 퇴직금, 원천세 연계

## 9. 범위와 구조

| 폴더 | 내용 | DB (`0031-payroll-cards.sql`) |
| --- | --- | --- |
| `cards/` | 카드·행·항목·명세서·특이사항·시프티. BPO 라우트(`bpo.routes.ts`)와 legacy 라우트(`legacy.routes.ts`)가 같은 서비스를 씁니다 | `payroll_cards`, `payroll_rows`, `payroll_card_items`, `payroll_payslips`, `payroll_payslip_notifications`, `payroll_manager_memos`, `payroll_legacy_preferences`, `payroll_external_integrations` |
| `severance/` | 퇴직금 정산(퇴직·중간) | `severance_settlements`, `severance_monthly_wages` |
| `withholding/` | 원천세 신고 요건 연동, 지급월 집계 | `filing_requirements`(기존) |
| `reports/` | 인건비 보고서 | 없음 |
| `adapters/` | 데스크 내보내기, 시프티. 명세서는 HR 어댑터를 다시 씁니다 | 없음 |

- 직원 정보는 HR `employees.repository`, `contracts.repository` 함수로만 읽습니다. 행에는 계산을 다시 할 수 있도록 HR 값의 스냅숏(`snapshot`)을 남깁니다.
- 서비스는 트랜잭션을 열지 않고 라우트가 감쌉니다. 어댑터를 부르는 단계(명세서 발송, 데스크 내보내기, 시프티)만 "트랜잭션 → 어댑터 → 트랜잭션"으로 나눕니다.

## 10. 카드 상태 기계

`card-status.ts`의 `CARD_TRANSITIONS` 한 곳에서 정합니다.

| 전이 | 출발 | 도착 | 행위자 | 원천세 신고 후 |
| --- | --- | --- | --- | --- |
| `confirmInput` (PUT `status: calculated`, legacy `calculate`) | `inputting` | `calculated` | 고객, 담당자 | 409 |
| `reopenInput` (PUT `status: inputting`) | `calculated` | `inputting` | 담당자 | 409 |
| `requestApproval` | `calculated` | `approval_requested` | 담당자 | 허용 |
| `approve` | `approval_requested` | `approved` | 고객 | 허용 |
| `reject` | `approval_requested` | `calculated` | 고객 | 409 |
| `withdrawApprovalRequest` (`cancel-approval`, 승인 전) | `approval_requested` | `calculated` | 담당자 | 409 |
| `cancelApproval` (`cancel-approval`, 승인 후) | `approved`, `payslips_sent` | `approval_requested` | 고객 | 409 |
| `sendPayslips` | 승인 이후 | `payslips_sent` (`exported`는 유지) | 고객, 담당자 | 허용 |
| `exportToDesk` | 승인 이후 | `exported` | 담당자 | 허용 |
| `legacyFix` (확장) | `calculated` | `approved` | 담당자 | 허용 |
| `legacyRelease` (확장) | `calculated`, `approved`, `payslips_sent` | `inputting` | 담당자 | 409 |

- 버전: 전이마다 `version`이 1씩 오르고 `ETag: "n"`으로 내려갑니다. BPO 전이는 `If-Match`가 없으면 428, 다르면 412 `VERSION_CONFLICT`입니다. legacy 클라이언트는 `If-Match`를 보내지 않으므로 legacy 라우트는 현재 버전을 씁니다.
- 입력 편집: `inputting`은 고객·담당자, `calculated`는 담당자만, 그 뒤는 아무도 못 합니다.
- `confirmInput`은 모든 행을 다시 계산합니다. 행을 고치면 계산 결과는 남기고 `is_calculated: false`로 표시합니다.
- legacy 상태 문자열(`card-status`)은 `inputting → input_available`, `calculated`·`approval_requested → calculating`, 승인 이후 `→ done`입니다(스펙 6절 "추정").

## 11. 추가 카드

같은 귀속월의 첫 카드가 `default`, 나머지가 `addition`입니다. 생성할 수 없는 사유(`can-create-additional-card`의 `reason`, 생성 시 409 `ADDITIONAL_CARD_NOT_ALLOWED`의 `reason`):

1. `no_default_card`, `parent_not_calculated`: 부모 카드가 `계산중`·`완료`가 아닙니다.
2. `input_card_exists`: 같은 세대(BPO/legacy)에 `inputting` 카드가 있습니다.
3. `withholding_filed`: 지급월 원천세가 신고되었습니다(이 경우만 코드가 `WITHHOLDING_FILED`).
4. `withholding_deadline_near`: 지급월 다음 달 10일의 5일 전(그 달 5일)부터입니다. 매뉴얼 예시가 모순이라 기준일은 미확정입니다.

추가 카드에는 근로소득 행을 넣을 수 없습니다(409 `WAGE_INCOME_ON_ADDITIONAL_CARD`). 삭제는 `inputting`일 때만 됩니다.

## 12. 소득 구분과 계산

| BPO `:segment` | legacy 키 | 엔진 `incomeType` | 입력 |
| --- | --- | --- | --- |
| `wage-monthly`, `wage-daily`, `wage-hourly` | `wage_salary` (`wage-salary`) | `wage_*` | HR 명부 후보(`candidates`)에서 추가. 기본급·시급·일급은 급여 계약, 일할은 입·퇴사·휴직에서 |
| `daily` | `daily` | `daily` | 이름·주민번호 직접 입력 또는 HR 일용직, `work_dates` 또는 `work_days` |
| `business` | `business` | `business` | 업종 코드, 세전/세후 |
| `other` | `other_labor` (`other-labor`) | `other` | 지급사유 코드(기본 `60`), 필요경비 |

- 4대보험은 귀속월 기준표, 소득세는 지급일 기준표로 계산합니다(1부 미해결 4번을 이렇게 정했습니다).
- 공제 방식이 `notice`인 보험은 행의 `insurance_notice` 금액을 씁니다. 고지 금액을 받는 연동이 없으므로 기본값은 0입니다.
- 손으로 넣은 금액(`overrides`)은 계산 뒤에 덮어쓰고 `reset-calculation`이 지웁니다.
- legacy `data`의 `taxable_incomes`·`other_deductions`는 지급·공제 항목 ID를 키로 하는 원본 맵이고, 저장할 때 행의 항목 금액에 합칩니다.

## 13. 명세서

- 다운로드와 발송은 승인 이후에만 됩니다. 그 전에는 409 `INVALID_TRANSITION`입니다.
- 발송: 행마다 `in_flight`를 기록한 트랜잭션을 닫고, PDF를 만들어 HR `NotificationAdapter`(템플릿 `payroll_payslip`, PDF 첨부)로 보낸 뒤 `success`/`fail`을 기록합니다. 이메일이 없으면 `fail`(`no_email`)입니다. 다시 보낼 수 있습니다.
- 수당별 계산식(`payment_formulas`)은 legacy `POST cards/:c/payslip`으로 저장하고, `copy-payment-formulas`는 직전 완료 카드에서 직원별로 가져옵니다.

## 14. 원천세 연계

- 원천세 신고의 `payroll_ledger_closed` 요건(`auto_linked = 1`)은 신고 기간에 지급일이 있는 카드(두 세대 모두)가 하나 이상이고 모두 승인 이후이면 `provided`, 아니면 `pending`입니다. 카드 생성·삭제·지급일 변경·상태 전이와 `scheduleFilings`의 신고 생성 때 다시 계산합니다.
- 카드가 없는 지급월은 `pending`입니다. 급여가 없는 달을 `not_applicable`로 바꾸는 흐름은 세무 쪽 결정이 필요합니다.
- 신고가 `filed`·`settled`이면 그 지급월 카드는 재계산·입력 되돌리기·반려·승인 취소·추가 카드·지급일 이동이 409 `WITHHOLDING_FILED`입니다(`payment_month` 포함).
- `GET /payroll/withholding-summary/:paymentMonth`(담당자 전용)는 완료 카드와 완료 퇴직 정산을 `A01`·`A03`·`A21`·`A25`·`A40`으로 묶습니다. 코드 대응을 확인하지 못해 모든 줄에 `verified: false`를 붙입니다.

## 15. 퇴직금 정산

- 경로 `/payroll/bpo/severance/settlements/**`, 메뉴 `severance_pay_settlement`(급여 구독, 추정). 고객은 읽기, 담당자는 쓰기입니다.
- 상태는 `in_progress → completed`이고 `exclude`/`include`로 `excluded`와 오갑니다. `complete`·`reopen`·`exclude`·`include`는 `If-Match`가 필요합니다. 퇴직 정산의 상태는 HR `setSeveranceSettlementStatus`로 HR 퇴직 정보에 반영합니다.
- 중간정산 사유는 9개입니다(`filter-options`의 `interim_reasons`). 완료된 중간정산이 있으면 다음 정산의 근속 시작일은 그 기준일 다음 날이고, 퇴직일이 그보다 이르면 400 `LEAVE_DATE_BEFORE_INTERIM`입니다.
- 3개월 임금은 기준일 이전 3개 역월입니다. 그 달의 계산된 급여 행이 있으면 그 금액(`source: payroll`), 없으면 급여 계약 금액(`source: contract`)입니다. 담당자가 `temp-save`·`complete`로 고칠 수 있습니다.
- 기준표 시작(2026-01) 이전 기준일은 가장 오래된 기준표로 계산합니다.

## 16. 인건비 보고서

`/report/labor-cost/:year`(+`/export`, CSV·BOM)는 경리 메뉴 `settlement_reports_profit_loss_labor_cost`를 씁니다. 급여가 경리보다 먼저 마운트되므로 경리의 404 자리표시자를 대신합니다. 귀속월별로 `calculated` 이후 카드의 소득 구분별 지급 총액, 사업주 부담 4대보험, 합계와 누계, HR 명부의 재직·입사·퇴사 인원을 냅니다.

## 17. 엔드포인트

### 17.1 BPO `/api/company/:id/payroll/bpo` (메뉴 `payroll_settlement`)

| 동사 | 경로 | 비고 |
| --- | --- | --- |
| GET | `payment-date-list?attribution_month` | 당월·익월 지급일, 신고된 지급월은 `available: false` |
| GET | `card-summary?year&status&limit&offset` | DRF 페이지 |
| POST | `card` | 기본 또는 추가 카드 |
| GET, PUT, DELETE | `card/:c` | PUT의 `status` 변경만 `If-Match` 필요 |
| GET | `card/:c/status` | |
| POST | `card/:c/{request-approval,approve,reject,cancel-approval}` | `If-Match` |
| POST | `card/:c/export-to-desk?export_type=payroll_ledger\|journal` | 담당자, `If-Match`. `export_type` 값은 추정 |
| GET, POST | `card/:c/{payment,deduction}-items`, `…/bulk` | `employment_type` 필터 |
| GET, POST | `card/:c/:segment/payroll-input/candidates` | |
| GET, POST | `card/:c/:segment/payroll-input` | POST는 일용·사업·기타 |
| POST | `card/:c/:segment/payroll-input/{excel,update,calculate,delete,refresh-employee-info,reset-calculation}` | `excel`은 CSV multipart `file` |
| GET | `card/:c/:segment/payroll-input/:r/{work-infos,payroll-info}` | |
| PUT | `card/:c/:segment/payroll-input/:r` | 근로 행 |
| GET, POST | `card/:c/:segment/work-input` | 근무 시트 |
| GET | `card/:c/:group/payslip`, `card/:c/:group/payslip/:r` | `group`: `wage`, `daily`, `business`, `other` |
| POST | `card/:c/payslip/download` | `application/pdf` |
| POST | `card/:c/payslip/send` | 행별 `notification_status` |
| GET, POST | `manager-memo` | 쓰기는 담당자 |
| GET, POST, DELETE | `shiftee-integration` | 해제 후 재연동은 409 `SHIFTEE_RELINK_BLOCKED` |
| … | `severance/settlements/**` | 15절. 스펙 5.9의 15개를 모두 구현 |

### 17.2 legacy `/api/company/:id/payroll` (메뉴 `payroll_management`)

스펙 5.1의 1~24번을 모두 구현했습니다. 25~30번은 1부의 계정 경로입니다. 다음은 스펙에 없는 확장입니다.

| 동사 | 경로 | 이유 |
| --- | --- | --- |
| POST | `cards` | 운영의 월간 자동 생성 배치를 대신합니다. 기본 카드면 HR 명부의 근로자로 채웁니다 |
| POST | `cards/:c/extensions/fix` | 담당자가 desk에서 하는 확정(`계산중 → 완료`) |
| POST | `cards/:c/extensions/release` | 확정 해제(`→ 입력가능`) |

`GET/POST /api/company/new-payroll/maintain-payroll/:id`는 회사 마운트 밖이라 public 라우터에서 인증·회사 범위·메뉴를 직접 검사합니다.

### 17.3 기타

| 동사 | 경로 | 비고 |
| --- | --- | --- |
| GET | `/api/company/:id/payroll/withholding-summary/:paymentMonth` | 담당자 전용 |
| GET | `/api/company/:id/report/labor-cost/:year`, `…/export` | 16절 |

## 18. 오류 코드

| 코드 | 상태 | 뜻 |
| --- | --- | --- |
| `WITHHOLDING_FILED` | 409 | 지급월 원천세 신고 완료 (`payment_month`) |
| `ADDITIONAL_CARD_NOT_ALLOWED` | 409 | 11절 사유 (`reason`) |
| `WAGE_INCOME_ON_ADDITIONAL_CARD` | 409 | 추가 카드에 근로소득 |
| `SHIFTEE_RELINK_BLOCKED` | 409 | 해제 후 재연동 |
| `LEAVE_DATE_BEFORE_INTERIM` | 400 | 퇴직일이 완료된 중간정산 기준일 이전 |
| `INVALID_TRANSITION`, `VERSION_CONFLICT`, `PRECONDITION_REQUIRED`, `PERMISSION_DENIED` | 409, 412, 428, 403 | 공통 |

## 19. 추정 응답

| 응답 | 형태 | 근거 |
| --- | --- | --- |
| 카드 | `{id, generation, kind, parent_card_id, title, name, attribution_month, payment_date, period_start, period_end, status, legacy_status, step, step_count, version, …_at, export_type, headcount_by_type, total_by_type, gross_total, net_total, uncalculated_count, withholding_filed}` | 목록 화면의 `n/3`, 소득별 인원·합계 |
| 행 | `{id, income_type, legacy_income_type, employee_id, name, resident_number(마스킹), …입력값, overrides, is_calculated, gross_pay, taxable_pay, non_taxable_pay, income_tax, local_income_tax, employee_insurance_total, employer_insurance_total, deduction_total, net_pay, calculation}` | `calculation`은 급여계산기 응답과 같은 형태 |
| legacy 카드 | 카드 + `{attr_date, status(input_available\|calculating\|done), card_status, headcount, net_pay_total_by_type, wage_salary[], daily[], business[], other_labor[]}`, 행에 `taxable_incomes`·`other_deductions` | 스펙 5.1 5번 |
| 명세서 발송 | `{results: [{row_id, notification_status, fail_reason}], card}` | 스펙 3.5 |

## 20. 메뉴 트리

`default-menu-tree.ts`(공유 파일)에 7절 제안에 더해 다음 leaf가 필요합니다.

```ts
leaf(514, '퇴직금 정산', 'severance_pay_settlement', '/severance-pay-settlement'),
```

## 21. 미해결 질문 (2부)

1. 세액 감면(중소기업 취업자 감면 등)은 지원하지 않습니다.
2. 보험 `notice` 방식의 고지 금액 연동이 없어 기본값이 0입니다.
3. 퇴직금 3개월 임금은 급여 행 또는 계약 금액의 근사치입니다. 휴직 기간 제외, 상여·연차수당 3개월분 안분은 담당자 입력에 맡깁니다.
4. `export-to-desk`의 `export_type` 값(`payroll_ledger`, `journal`)과 데스크 응답은 확인되지 않았습니다.
5. 카드가 없는 지급월의 `payroll_ledger_closed`는 `pending`입니다. 자동 `not_applicable` 여부는 세무 쪽 결정이 필요합니다.
6. 추가 카드 마감 기준일(11절 4번)과 legacy `card-status` 문자열.
7. 원천세 집계 코드 대응(A01·A03·A21·A25·A40)과 일용 소액부징수 판정 단위.
8. legacy 자동 생성 배치의 실행 시점. 지금은 확장 `POST cards`로 대신합니다.
