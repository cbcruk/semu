# 인사 규칙 결정

인사 규칙 13개의 열린 질문 34개에 대한 서버 결정입니다. 설계는 [hr.md](../hr.md)에 있습니다. 읽는 법은 [README](README.md)를 따릅니다.

> **상태: 결정됨 (가정 포함, 2026-11-05).** 권장안을 결정으로 채택했습니다. **보류**는 법령·고시 확인 전까지 현행 동작을 임시 결정으로 둡니다.

## 요약

| 영역 | 규칙 | 질문 | 따름 | 바꿈 | 보류 |
|---|---|---:|---:|---:|---:|
| 직원 | [employee-duplicate-rrn](#employee-duplicate-rrn) | 2 | 2 | 0 | 0 |
| 직원 | [employee-status](#employee-status) | 2 | 1 | 1 | 0 |
| 직원 | [legacy-employment-status](#legacy-employment-status) | 2 | 1 | 1 | 0 |
| 직원 | [contract-expiry-warning](#contract-expiry-warning) | 3 | 3 | 0 | 0 |
| 계약 | [work-contract-validation](#work-contract-validation) | 3 | 0 | 2 | 1 |
| 계약 | [payroll-contract-wage](#payroll-contract-wage) | 3 | 0 | 1 | 2 |
| 계약 | [indefinite-conversion-alert](#indefinite-conversion-alert) | 3 | 2 | 0 | 1 |
| 4대보험 | [social-insurance-eligibility](#social-insurance-eligibility) | 3 | 2 | 0 | 1 |
| 휴직·퇴사 | [leave-validation](#leave-validation) | 3 | 1 | 1 | 1 |
| 휴직·퇴사 | [retirement-validation](#retirement-validation) | 3 | 3 | 0 | 0 |
| 조직 | [organization-unit-in-use](#organization-unit-in-use) | 2 | 2 | 0 | 0 |
| 세금·가족 | [deduction-validation](#deduction-validation) | 3 | 2 | 0 | 1 |
| 세금·가족 | [dependant-count](#dependant-count) | 2 | 1 | 0 | 1 |
| | **합계** | **34** | **20** | **6** | **8** |

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
| 3 | 단순노무직종 감액 금지를 검사할까요 | **보류:** 직종 코드가 없어 검사하지 않습니다. 직종 입력이 생기면 추가합니다 | 고용노동부 고시 직종 분류 확인이 필요합니다 |

**바뀌는 케이스:**
- `reduced probation pay on a one-year contract ending 12-31`: `PROBATION_REDUCTION_NOT_ALLOWED` → 통과

### payroll-contract-wage

[규칙 문서](../../reference/rules/payroll-contract-wage.md) · 케이스 11 · 질문 3

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | 고정수당 가산율을 법정 가산율로 바꿀까요 | **보류:** 가산율 1.0을 유지합니다. 급여 컨텍스트의 수당 계산과 대조한 뒤 정합니다 | 스펙 R10 메모: 스크린샷 값이 1.0과 맞습니다. 포괄임금 약정이 1.5배를 이미 반영했을 수 있습니다 |
| 2 | 최저시급을 참조데이터로 옮길까요 | **바꿈:** `calculateWage`가 `minimumHourlyWage`를 입력으로 받고, 서비스가 연도별 값을 넣습니다 | 고시 값은 해마다 바뀝니다 |
| 3 | 수습 기간 최저임금(90%)을 판정할까요 | **보류:** 수습 기준시급만 내보냅니다 | 단순노무직종 여부(work-contract-validation 3)와 함께 정해야 합니다 |

### indefinite-conversion-alert

[규칙 문서](../../reference/rules/indefinite-conversion-alert.md) · 케이스 7 · 질문 3

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | 전환 경계를 시작일 + 24개월로 볼까요 | **따름** | 기간제법 제4조 "2년을 초과하여"를 체인 종료일이 전환일 이상이면 초과로 봅니다 |
| 2 | 55세 외 예외를 받을까요 | **보류:** 예외 사유 입력이 생기면 `exemptReason`을 늘립니다 | 예외 사유(전문자격 등)는 증빙이 필요해 정책 확인이 필요합니다 |
| 3 | 알림 시작 90일을 설정으로 둘까요 | **따름:** 상수 90일 | 현행과 같습니다 |

## 4대보험

### social-insurance-eligibility

[규칙 문서](../../reference/rules/social-insurance-eligibility.md) · 케이스 11 · 질문 3

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | 상호주의 국가 목록을 받을까요 | **보류:** 빈 목록을 유지하고 메시지로 확인을 안내합니다 | 고용노동부 고시 국가 목록 확인이 필요합니다 |
| 2 | 월 60시간 분기를 정리할까요 | **따름:** 결과가 같으므로 그대로 둡니다 | 주 15시간 미만 검사가 먼저 걸러 결과가 바뀌지 않습니다 |
| 3 | 60세 이후 임의계속가입을 다룰까요 | **따름:** 다루지 않습니다. 사용자가 권장값을 바꿔 저장할 수 있습니다 | 판정은 권장값이고 저장은 사용자가 합니다 |

## 휴직·퇴사

### leave-validation

[규칙 문서](../../reference/rules/leave-validation.md) · 케이스 13 · 질문 3

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | 위반을 모두 돌려줄까요 | **바꿈:** 422 `violations`에 모두 담습니다. 겹침만 409 `LEAVE_OVERLAP`입니다 | 화면이 한 번에 고칠 수 있습니다. 첫 위반은 현행과 같아 픽스처 기대값은 바뀌지 않습니다 |
| 2 | 육아휴직 한도를 자녀별로 볼까요 | **따름:** 직원별 365일 합계만 봅니다 | 자녀 정보와 휴직을 잇는 입력이 없습니다 |
| 3 | 납입고지유예 1개월 기준이 공단과 같을까요 | **보류:** 현행 식을 유지합니다 | 국민건강보험법 시행규칙 확인이 필요합니다 |

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
| 3 | 특화선도 구간 비율을 둘까요 | **보류:** 한 비율만 저장합니다 | 조특법 제18조의2 확인이 필요합니다 |

### dependant-count

[규칙 문서](../../reference/rules/dependant-count.md) · 케이스 8 · 질문 2

| # | 질문 | 권장 | 근거 |
|---|---|---|---|
| 1 | 8~20세를 연 나이로 셀까요 | **따름** | 간이세액표 적용 방법이 연도 기준입니다 |
| 2 | 보육수당 비과세 나이를 바꿀까요 | **보류:** 만 6세 이하를 유지합니다 | 소득세법 시행령 제17조의2 현행 기준 확인이 필요합니다 |
