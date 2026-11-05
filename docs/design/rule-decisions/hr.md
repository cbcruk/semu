# 인사 규칙 결정

인사 규칙 13개의 열린 질문 34개에 대한 서버 결정입니다. 설계는 [hr.md](../hr.md)에 있습니다. 읽는 법은 [README](README.md)를 따릅니다.

> **상태: 결정됨 (가정 포함, 2026-11-05).** 권장안을 결정으로 채택했습니다. 보류 8건 중 7건은 법령·고시 원문을 확인해 정했습니다. 남은 **보류**는 현행 동작을 임시 결정으로 둡니다.

## 요약

| 영역 | 규칙 | 질문 | 따름 | 바꿈 | 보류 |
|---|---|---:|---:|---:|---:|
| 직원 | [employee-duplicate-rrn](#employee-duplicate-rrn) | 2 | 2 | 0 | 0 |
| 직원 | [employee-status](#employee-status) | 2 | 1 | 1 | 0 |
| 직원 | [legacy-employment-status](#legacy-employment-status) | 2 | 1 | 1 | 0 |
| 직원 | [contract-expiry-warning](#contract-expiry-warning) | 3 | 3 | 0 | 0 |
| 계약 | [work-contract-validation](#work-contract-validation) | 3 | 0 | 3 | 0 |
| 계약 | [payroll-contract-wage](#payroll-contract-wage) | 3 | 0 | 2 | 1 |
| 계약 | [indefinite-conversion-alert](#indefinite-conversion-alert) | 3 | 2 | 1 | 0 |
| 4대보험 | [social-insurance-eligibility](#social-insurance-eligibility) | 3 | 2 | 1 | 0 |
| 휴직·퇴사 | [leave-validation](#leave-validation) | 3 | 1 | 2 | 0 |
| 휴직·퇴사 | [retirement-validation](#retirement-validation) | 3 | 3 | 0 | 0 |
| 조직 | [organization-unit-in-use](#organization-unit-in-use) | 2 | 2 | 0 | 0 |
| 세금·가족 | [deduction-validation](#deduction-validation) | 3 | 3 | 0 | 0 |
| 세금·가족 | [dependant-count](#dependant-count) | 2 | 2 | 0 | 0 |
| | **합계** | **34** | **22** | **11** | **1** |

## 직원

### employee-duplicate-rrn

[규칙 문서](../../reference/rules/employee-duplicate-rrn.md) · 케이스 7 · 질문 2

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | 직원 종류가 다르면 같은 주민번호를 허용할까요 | **따름:** 같은 종류 안에서만 중복을 막습니다 | 한 사람이 근로소득자이면서 사업소득자일 수 있습니다. 종류마다 신고서가 다릅니다 ([직원](../hr.md#직원-애그리거트)) |
| 2 | 재입사를 서버가 추정할까요 | **따름:** `isRejoin`을 명시해야 합니다. 409 응답의 `duplicateEmployeeId`로 화면이 재입사 등록을 제안합니다 | 추정하면 실수로 같은 사람을 두 번 등록하는 것을 막지 못합니다 |

### employee-status

[규칙 문서](../../reference/rules/employee-status.md) · 케이스 9 · 질문 2

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | 퇴사일 당일을 재직으로 볼까요 | **따름:** 퇴사일 다음날부터 `RESIGNED`입니다 | 4대보험 상실일이 퇴사일 다음날이라 같은 경계입니다 |
| 2 | 입사일을 필수로 할까요 | **바꿈:** 생성 API가 `joinDate`를 필수로 받습니다(매뉴얼 필수 항목). 상태 함수는 그대로 둡니다 | [매뉴얼 구성원 정보](../../../alfred-manual/04-인사/02-구성원-정보.md) 필수 항목. 이관 데이터에는 입사일 없는 직원이 있을 수 있어 함수는 `JOINED`로 둡니다 |

**바뀌는 케이스:** 없음 (API 입력 검증만 바뀝니다)

### legacy-employment-status

[규칙 문서](../../reference/rules/legacy-employment-status.md) · 케이스 7 · 질문 2

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | 처리중 상태를 열린 신고로 옮길까요 | **따름:** `migrateLegacyEmploymentStatus`가 처리중을 `PENDING` 신고로 바꿉니다 | 재설계는 상태와 신고를 나눕니다 ([4대보험 신고](../hr.md#4대보험-신고)) |
| 2 | 입사 전 직원을 `PRE_JOINED`로 보일까요 | **바꿈:** 재설계 API는 `PRE_JOINED`를 그대로 보입니다. 이 함수는 이관·대조용으로만 남습니다 | 입사 전 직원은 급여 대상이 아니어서 화면이 구분해야 합니다 |

**바뀌는 케이스:** 없음 (함수는 현행 대조용)

### contract-expiry-warning

[규칙 문서](../../reference/rules/contract-expiry-warning.md) · 케이스 9 · 질문 3

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | 경고 기간을 회사 설정으로 둘까요 | **따름:** 30일 기본값을 상수로 둡니다. 설정이 생기면 `employeeWarnings`의 `warningDays`로 넘깁니다 | 스펙이 N을 확인하지 못했고 30일을 권장했습니다 |
| 2 | 공백을 둔 갱신도 갱신으로 볼까요 | **따름:** 공백은 무기계약 전환 체인이 따로 판정합니다 | 만료 경고는 "다음 계약이 있는가"만 묻습니다 |
| 3 | 종료일 당일을 만료 임박으로 볼까요 | **따름:** 종료일까지 계약 중이고 다음날부터 만료입니다 | 계약 상태(`workContractStatus`)와 같은 경계입니다 |

## 계약

### work-contract-validation

[규칙 문서](../../reference/rules/work-contract-validation.md) · 케이스 10 · 질문 3

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | 1월 1일 ~ 12월 31일 계약을 1년 계약으로 볼까요 | **바꿈:** `시작일 + 12개월 ≤ 종료일 + 1일`이면 1년 이상입니다 | 최저임금법 시행령 제3조의 "1년 이상 근로계약"은 기간으로 셉니다. 현행 식은 정확히 1년인 계약을 막습니다 |
| 2 | 지급률을 ppm으로 받을까요 | **바꿈:** `payRatePpm`(900,000~1,000,000) 정수로 받습니다 | 비율을 정수로 저장하는 규약([conventions](../conventions.md))을 따릅니다 |
| 3 | 단순노무직종 감액 금지를 검사할까요 | **바꿈:** 근로계약에 한국표준직업분류 코드(`standardOccupationCode`, 선택)를 받고, 대분류 9면 지급률 100% 미만을 422 `PROBATION_REDUCTION_SIMPLE_LABOR`로 거절합니다. 코드가 없으면 검사하지 않습니다 | [최저임금법 제5조 ② 단서](https://www.law.go.kr/법령/최저임금법). [고용노동부고시 제2018-23호](https://www.law.go.kr/LSW/admRulLsInfoP.do?admRulSeq=2100000118064)가 단순노무직종을 한국표준직업분류 대분류 9(단순노무 종사자)로 정합니다 |

**바뀌는 케이스:**
- `reduced probation pay on a one-year contract ending 12-31`: `PROBATION_REDUCTION_NOT_ALLOWED` → 통과
- 질문 3은 새 입력이라 픽스처 케이스는 바뀌지 않습니다. `work-contract-validation.fixtures.test.ts`가 따로 확인합니다

### payroll-contract-wage

[규칙 문서](../../reference/rules/payroll-contract-wage.md) · 케이스 11 · 질문 3

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | 고정수당 가산율을 법정 가산율로 바꿀까요 | **보류:** 가산율 1.0을 유지합니다. 급여 컨텍스트의 수당 계산과 대조한 뒤 정합니다 | 스펙 R10 메모: 스크린샷 값이 1.0과 맞습니다. 확인한 것: 법정 가산은 연장·야간·휴일(8시간 이내) 50%, 휴일 8시간 초과 100%입니다([근로기준법 제56조](https://www.law.go.kr/법령/근로기준법)). 다만 상시 4명 이하 사업장은 법 일부만 적용됩니다(제11조 ②). 남은 것: 회사의 상시 근로자 수 입력과 Payroll `overtime-multipliers`와의 대조 |
| 2 | 최저시급을 참조데이터로 옮길까요 | **바꿈:** `calculateWage`가 `minimumHourlyWage`를 입력으로 받고, 서비스가 연도별 값을 넣습니다 | 고시 값은 해마다 바뀝니다 |
| 3 | 수습 기간 최저임금(90%)을 판정할까요 | **바꿈:** 감액 허용 조건(1년 이상 계약, 단순노무 아님, 지급률 90% 이상)은 근로계약 검증이 봅니다. 급여계약은 수습이 3개월을 넘고 수습 시급(최저임금 산입 시급 × 지급률)이 최저시급보다 낮으면 `PROBATION_BELOW_MINIMUM_WAGE` 경고를 냅니다 | 감액은 수습 시작일부터 3개월 이내만, 시간급 최저임금에서 10%를 뺀 금액입니다([최저임금법 제5조 ②](https://www.law.go.kr/법령/최저임금법), [시행령 제3조](https://www.law.go.kr/법령/최저임금법시행령)) |

### indefinite-conversion-alert

[규칙 문서](../../reference/rules/indefinite-conversion-alert.md) · 케이스 7 · 질문 3

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | 전환 경계를 시작일 + 24개월로 볼까요 | **따름** | 기간제법 제4조 "2년을 초과하여"를 체인 종료일이 전환일 이상이면 초과로 봅니다 |
| 2 | 55세 외 예외를 받을까요 | **바꿈:** 근로계약에 `termLimitExemption`(`PROJECT_COMPLETION`·`REPLACEMENT`·`STUDY_OR_TRAINING`·`PROFESSIONAL`·`GOVERNMENT_JOB_PROGRAM`·`OTHER_STATUTORY`)을 받습니다. 예외 사유가 없는 계약이 전환일 이후까지 이어지면 그날 전환된 것으로 보고(제4조 ②) 뒤의 예외 계약은 보지 않습니다. 그런 계약이 없고 사슬의 가장 늦은 계약에 사유가 있으면 예외(`exemptReason`)입니다. 만 55세가 먼저입니다. 증빙은 회사가 보관합니다 | [기간제법 제4조 ① 1–6호](https://www.law.go.kr/법령/기간제및단시간근로자보호등에관한법률), [시행령 제3조](https://www.law.go.kr/법령/기간제및단시간근로자보호등에관한법률시행령). 고령자는 55세 이상입니다([고령자고용법 시행령 제2조 ①](https://www.law.go.kr/법령/고용상연령차별금지및고령자고용촉진에관한법률시행령)) |
| 3 | 알림 시작 90일을 설정으로 둘까요 | **따름:** 상수 90일 | 현행과 같습니다 |

**바뀌는 케이스:** 없음. 질문 2는 새 입력이라 `indefinite-conversion.fixtures.test.ts`가 따로 확인합니다.

**열린 질문:** 예외 기간을 2년 계산에서 뺄지 정하지 않았습니다. 지금은 사슬 시작일 + 24개월을 전환일로 두고 예외 기간도 셉니다. 예를 들어 일반 18개월 → 예외 12개월 → 일반 2개월이면 마지막 일반 계약이 전환일 뒤에 있으므로 전환으로 봅니다. 예외 기간을 빼면 일반 사용기간은 20개월이라 전환이 아닙니다. 판례·행정해석을 확인해 정합니다([hr.md 열린 질문](../hr.md#열린-질문) 9).

## 4대보험

### social-insurance-eligibility

[규칙 문서](../../reference/rules/social-insurance-eligibility.md) · 케이스 11 · 질문 3

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | 상호주의 국가 목록을 받을까요 | **바꿈:** 국가 목록을 두지 않습니다. 상호주의 체류자격은 D-7·D-8·D-9뿐이고, 가입을 권하며 `EI_FOREIGNER_RECIPROCITY_CHECK`로 본국법 확인을 안내합니다. 그 밖의 체류자격은 고용보험을 `EXEMPT_FOREIGNER`로 제외합니다. 신청하면 적용되는 체류자격(F-4, C-4, E-1~E-10, H-1. `EI_OPT_IN_VISAS`)만 `EI_FOREIGNER_OPTIONAL`로 신청을 안내하고, 목록에 없는 체류자격(D-2 등)은 신청할 수 없어 안내하지 않습니다 | [고용보험법 시행령 제3조의3](https://www.law.go.kr/법령/고용보험법시행령): 주재·기업투자·무역경영은 법 전부를 적용하되 본국법이 대한민국 국민에게 고용보험에 상응하는 보험료·급여를 적용하지 않으면 제외합니다(제1호 가목). 국가 목록을 고시로 위임하지 않습니다. 그 밖의 취업 체류자격과 재외동포는 신청해야 적용합니다(제2호). 취업 체류자격은 C-4, E-1~E-10, H-2이고 H-1은 취업하면 같이 봅니다([출입국관리법 시행령 제23조 ①·⑤](https://www.law.go.kr/법령/출입국관리법시행령)) |
| 2 | 월 60시간 분기를 정리할까요 | **따름:** 결과가 같으므로 그대로 둡니다 | 주 15시간 미만 검사가 먼저 걸러 결과가 바뀌지 않습니다 |
| 3 | 60세 이후 임의계속가입을 다룰까요 | **따름:** 다루지 않습니다. 사용자가 권장값을 바꿔 저장할 수 있습니다 | 판정은 권장값이고 저장은 사용자가 합니다 |

**바뀌는 케이스:** `E-7 foreigner without agreement` → 메시지 `EI_FOREIGNER_OPTIONAL`(고용보험 미적용은 그대로). `D-2 foreigner is optional` → 메시지 없음, 고용보험 미적용(`EXEMPT_FOREIGNER`). 응답 코드 `EI_FOREIGNER_RECIPROCITY_AGREEMENT`·`NON_AGREEMENT`는 `EI_FOREIGNER_RECIPROCITY_CHECK` 하나로 바뀝니다.

## 휴직·퇴사

### leave-validation

[규칙 문서](../../reference/rules/leave-validation.md) · 케이스 13 · 질문 3

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | 위반을 모두 돌려줄까요 | **바꿈:** 422 `violations`에 모두 담습니다. 겹침만 409 `LEAVE_OVERLAP`입니다 | 화면이 한 번에 고칠 수 있습니다. 첫 위반은 현행과 같아 픽스처 기대값은 바뀌지 않습니다 |
| 2 | 육아휴직 한도를 자녀별로 볼까요 | **따름:** 직원별 365일 합계만 봅니다 | 자녀 정보와 휴직을 잇는 입력이 없습니다 |
| 3 | 납입고지유예 1개월 기준이 공단과 같을까요 | **바꿈:** "시작일 + 1개월" 대신 유예되는 달이 있는지로 봅니다. 시작일이 속한 달의 다음 달(1일이면 그 달)부터 복직일이 속한 달(1일이면 그 전달)까지가 한 달 이상이어야 합니다(`nhisDeferredMonths`). 코드는 `DEFERRAL_NEEDS_ONE_MONTH` 그대로입니다 | [국민건강보험법 제79조 ⑤](https://www.law.go.kr/법령/국민건강보험법), [시행규칙 제50조 ①·④](https://www.law.go.kr/법령/국민건강보험법시행규칙). 법령에 "1개월 이상 휴직" 요건은 없습니다 |

**바뀌는 케이스:** `nhis deferral on a short leave`(3월 1일–30일): `DEFERRAL_NEEDS_ONE_MONTH` → 통과(3월분 유예).

### retirement-validation

[규칙 문서](../../reference/rules/retirement-validation.md) · 케이스 7 · 질문 3

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | 상세 사유를 필수로 할까요 | **따름:** 선택입니다 | 상실신고 서식의 상세 사유는 사유 코드만으로도 접수됩니다(매뉴얼 퇴사 절) |
| 2 | 중간정산일 당일 퇴사를 허용할까요 | **따름** | 현행과 같습니다 |
| 3 | 정산 상태를 이벤트로 받을까요 | **따름:** 급여의 `severance-settlement.status-changed`를 받아 직원의 `severanceSettlementStatus`를 갱신합니다 | 정산은 급여 컨텍스트가 소유합니다 ([퇴직](../hr.md#퇴직)) |

## 조직

### organization-unit-in-use

[규칙 문서](../../reference/rules/organization-unit-in-use.md) · 케이스 6 · 질문 2

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | 이력만 있는 부서를 비활성으로 대신할까요 | **따름:** 삭제를 409로 막습니다 | 매뉴얼 동작과 같습니다. 비활성은 요구가 생기면 추가합니다 |
| 2 | 대소문자·공백 차이도 막을까요 | **따름:** 앞뒤 공백만 무시합니다 | 한글 이름이 대부분입니다 |

## 세금·가족

### deduction-validation

[규칙 문서](../../reference/rules/deduction-validation.md) · 케이스 9 · 질문 3

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | 다른 사유의 비율을 받을까요 | **따름:** 같은 유형 안의 비율을 받습니다 | 현행과 같습니다 |
| 2 | 연 한도를 급여가 적용할까요 | **따름:** 사유의 `annualLimit`을 `HrDirectory.findTaxWithholding`으로 내보냅니다 | 한도는 지급 누계가 필요해 급여가 계산합니다 |
| 3 | 특화선도 구간 비율을 둘까요 | **따름:** 한 비율만 저장합니다. 3년 뒤 50% 구간은 감면 설정을 새 효력일로 다시 저장합니다 | 근거는 제18조의2가 아니라 [조세특례제한법 제18조 ①](https://www.law.go.kr/법령/조세특례제한법)입니다. 소재·부품·장비 외국인기술자는 3년 70%, 그다음 2년 50%이고(규칙 문서의 "7년"은 틀림), 2022-12-31 이전 최초 근로만 해당합니다. 일반 외국인기술자는 10년 50%(2026-12-31 이전 최초 근로)입니다 |

### dependant-count

[규칙 문서](../../reference/rules/dependant-count.md) · 케이스 8 · 질문 2

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | 8~20세를 연 나이로 셀까요 | **따름** | 간이세액표 적용 방법이 연도 기준입니다 |
| 2 | 보육수당 비과세 나이를 바꿀까요 | **따름:** 6세 이하를 유지합니다. 나이는 과세기간 개시일(1월 1일) 현재로 봅니다(그해 − 출생 연도 ≤ 6) | [소득세법 제12조제3호머목2)](https://www.law.go.kr/법령/소득세법/제12조)(법률 제21221호, 2025. 12. 23. 개정, 2026. 1. 1. 시행): "근로자 또는 그 배우자의 해당 과세기간 개시일을 기준으로 6세 이하(6세가 되는 날과 그 이전 기간을 말한다…)인 자녀의 보육과 관련하여 사용자로부터 지급받는 급여로서 해당 자녀 1명당 월 20만원 이내의 금액". 8세 미만 개정은 없습니다. 시행령 제17조의2(2025. 2. 28. 신설)는 출산지원금(머목1))의 범위라 나이와 관계없습니다. 기존 케이스는 그대로 통과하고, 기준일을 `asOf`의 만 나이에서 과세기간 개시일로 맞췄습니다. 법이 "근로자 또는 그 배우자의 … 자녀"라 현행이 허용하던 손자녀는 뺍니다(손자녀 케이스는 픽스처에 없음, `dependant-rules.test.ts`) |
