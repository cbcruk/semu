# 규칙 결정: Payroll

계산 엔진·급여대장·퇴직금·원천세 연계 규칙 14개의 열린 질문 34개에 대한 서버 결정입니다. 설계는 [payroll.md](../payroll.md)에 있습니다. 읽는 법은 [README](README.md#읽는-법)를 따릅니다.

> **상태: 결정됨 (2026-11-05).** 요율·세액표 수치는 2026-11-05에 법령·고시 원문(국가법령정보센터, 최저임금위원회, 국민건강보험공단)으로 확인해 보류 6건을 풀었습니다. 남은 보류 8건 중 기준표 값은 장기요양 비율 반올림뿐이고, 나머지는 제품 동작이나 서식 확인이 필요한 것입니다. 원문으로 확인하지 못한 값은 기준표의 `unverifiedPaths`로 화면에 표시합니다.

## 요약

| 영역 | 규칙 | 질문 | 따름 | 바꿈 | 보류 |
|---|---|---:|---:|---:|---:|
| 계산 엔진 | [social-insurance-premiums](#social-insurance-premiums) | 3 | 2 | 0 | 1 |
| 계산 엔진 | [simple-income-tax](#simple-income-tax) | 3 | 3 | 0 | 0 |
| 계산 엔진 | [daily-worker-withholding](#daily-worker-withholding) | 3 | 3 | 0 | 0 |
| 계산 엔진 | [business-income-withholding](#business-income-withholding) | 3 | 1 | 0 | 2 |
| 계산 엔진 | [other-income-withholding](#other-income-withholding) | 2 | 1 | 0 | 1 |
| 계산 엔진 | [non-taxable-limits](#non-taxable-limits) | 2 | 2 | 0 | 0 |
| 계산 엔진 | [overtime-multipliers](#overtime-multipliers) | 2 | 0 | 1 | 1 |
| 계산 엔진 | [wage-proration](#wage-proration) | 1 | 0 | 0 | 1 |
| 계산 엔진 | [minimum-wage-warning](#minimum-wage-warning) | 2 | 1 | 0 | 1 |
| 퇴직금 | [severance-pay](#severance-pay) | 3 | 2 | 0 | 1 |
| 급여대장 | [payroll-ledger-transitions](#payroll-ledger-transitions) | 4 | 0 | 4 | 0 |
| 급여대장 | [additional-payroll-ledger](#additional-payroll-ledger) | 2 | 2 | 0 | 0 |
| 급여대장 | [duplicate-wage-income](#duplicate-wage-income) | 2 | 1 | 1 | 0 |
| 원천세 연계 | [withholding-ledger-closed](#withholding-ledger-closed) | 2 | 1 | 1 | 0 |
| | **합계** | **34** | **19** | **7** | **8** |

## social-insurance-premiums

규칙: [social-insurance-premiums.md](../../reference/rules/social-insurance-premiums.md)

| # | 질문 | 결정 | 근거 |
|---|---|---|---|
| 1 | 2026년 장기요양 비율 13.14%가 맞을까요 | **보류:** 요율은 확인했습니다(장기요양 100만분의 9,448, 건강 1만분의 719). 2026-11 기준표부터 13.14%(0.1314)를 확인값으로 두고, 2026. 1~10월은 공단이 반올림 비율을 썼는지 확인할 때까지 미확인으로 둡니다 | 노인장기요양보험법 시행령 제4조, 법 제9조제1항. 비율을 소수점 다섯째자리에서 반올림하는 개정 조문(법률 제21690호, 2026. 11. 27. 시행)은 부칙 제3조로 시행일이 속하는 달의 장기요양보험료부터 적용합니다. 4대보험은 귀속월 기준표를 씁니다 |
| 2 | 2026-07 이후 국민연금 기준소득월액 상하한 | **따름:** 2026-07 기준표에 고시값 하한 410,000원, 상한 6,590,000원을 둡니다 | 보건복지부고시 제2026-31호(2026. 2. 2., 2026. 7. 1. 시행). 2025-07 값(400,000 ~ 6,370,000)도 제2025-24호로 확인했습니다 |
| 3 | 보험료 10원 미만 절사를 규칙으로 둘까요 | **따름** | 국민연금법 제117조, 국민건강보험법 제107조, 노인장기요양보험법 제64조가 국고금관리법 제47조(10원 미만 끝수)를 따릅니다. 고용·산재보험은 조문을 찾지 못해 미확인입니다. 고지 방식(`NOTICE`)은 공단 금액을 그대로 씁니다 |

**바뀌는 케이스:** 없음. 픽스처는 2026-01 기준표를 씁니다. 2026-07 기준표의 상하한 케이스(월 800만원 → 313,020원, 30만원 → 19,470원)는 엔진 테스트에 더했습니다.

## simple-income-tax

규칙: [simple-income-tax.md](../../reference/rules/simple-income-tax.md)

| # | 질문 | 결정 | 근거 |
|---|---|---|---|
| 1 | 공식 간이세액표(74,350원)와 산식(60,380원)의 차이 | **따름:** 산식(`MIDPOINT_FORMULA`)을 유지하고 결과를 미확인으로 표시합니다 ([review.md](../review.md#결정) D4). 공식 표가 필요해지면 기준표의 전략을 `lookupSimpleTaxTable`로 바꿉니다 | 전략이 기준표 데이터라 코드 변경 없이 바꿀 수 있습니다 |
| 2 | 2026년 간이세액표 개정 여부 | **따름:** 2026-03 기준표를 더해 8~20세 자녀 공제액을 1명 20,830원, 2명 45,830원, 3명 이상 1명당 33,330원 추가로 바꿉니다. 계산식·행 폭·1천만원 초과 산식은 그대로입니다 | 소득세법 시행령 별표 2 <개정 2026. 2. 27.>, 영 부칙(대통령령 제36129호) 제15조: 2026. 3. 1. 이후 원천징수분부터 |
| 3 | 중소기업 취업자 감면율·한도 | **따름:** 감면율은 행 입력이고 한도는 과세기간 200만원입니다. 청년 90%, 그 외 70% | 조세특례제한법 제30조제1항 |

**바뀌는 케이스:** 없음. 픽스처는 2026-01 기준표(자녀 1명 12,500원)를 씁니다. 2026. 3월 이후 지급분은 새 자녀 공제액이 적용됩니다. 비율 입력이 퍼센트에서 ppm(`withholdingRatePpm`)으로 바뀝니다.

## daily-worker-withholding

규칙: [daily-worker-withholding.md](../../reference/rules/daily-worker-withholding.md)

| # | 질문 | 결정 | 근거 |
|---|---|---|---|
| 1 | 소액부징수를 날마다 볼까요, 지급 건마다 볼까요 | **따름:** 행(지급 건) 합계로 봅니다 | 재설계 전 구현과 같고, 행이 지급 단위입니다 |
| 2 | 2026년 일 근로소득공제(15만원) 인상 여부 | **따름:** 15만원 그대로입니다 | 소득세법 제47조제2항 "1일 15만원"(2018. 12. 31. 개정 이후 그대로) |
| 3 | 근무일수 균등 분할 | **따름** | 화면이 행 총액과 근무일자만 받습니다. 날짜별 금액 입력이 생기면 행 입력을 넓힙니다 |

**바뀌는 케이스:** 없음.

## business-income-withholding

규칙: [business-income-withholding.md](../../reference/rules/business-income-withholding.md)

| # | 질문 | 결정 | 근거 |
|---|---|---|---|
| 1 | 세후 입력 역산 나누기(1 − 0.033) | **따름:** 그 값에서 시작해 세후가 입력과 같아지는 지급액을 찾습니다 | 절사 때문에 나누기만으로는 1원이 어긋나는 경우를 막습니다 |
| 2 | 예술인 고용보험 0.8%와 경비 공제 | **보류:** 0.8%는 확인했습니다. 경비 공제는 아직 적용하지 않습니다 | 보험료징수법 시행령 제56조의5제2항(1천분의 16, 2분의 1씩). 같은 조 제1항은 고용노동부장관 고시 필요경비를 보수에서 빼라고 해서, 고시 경비율을 확인해야 합니다 |
| 3 | 사업소득 업종코드 | **보류:** 기억한 목록을 `verified: false`로 냅니다 | 간이지급명세서 서식 확인 필요 |

**바뀌는 케이스:** 없음.

## other-income-withholding

규칙: [other-income-withholding.md](../../reference/rules/other-income-withholding.md)

| # | 질문 | 결정 | 근거 |
|---|---|---|---|
| 1 | 지급사유 코드, 서화 경비율 80%, 연금해지 세율 15% | **보류:** 미확인 값으로 냅니다 | 소득세법 확인 필요 |
| 2 | 과세최저한을 건별로 볼까요, 행별로 볼까요 | **따름:** 행별로 봅니다 | 행 하나가 지급 건 하나입니다 |

**바뀌는 케이스:** 없음.

## non-taxable-limits

규칙: [non-taxable-limits.md](../../reference/rules/non-taxable-limits.md)

| # | 질문 | 결정 | 근거 |
|---|---|---|---|
| 1 | 야간근로·국외근로·육아휴직·학자금·직무발명 한도 | **따름:** 국외근로 월 100만원(특수 500만원), 야간근로 연 240만원, 직무발명 연 700만원, 육아휴직·학자금은 고정 한도 없음 | 소득세법 제12조제3호, 시행령 제11조·제16조·제17조·제17조의3. 보육수당은 제12조제3호머목2)가 "해당 자녀 1명당 월 20만원 이내"입니다(법률 제21221호, 2025. 12. 23. 개정, 2026. 1. 1. 이후 지급분). 엔진은 20만원 × HR 소득세 공제 설정의 대상 자녀 수(`childcareChildrenCount`)를 그달 한도로 쓰고, 값이 없으면 1명으로 보고 `CHILDCARE_CHILDREN_UNKNOWN` 경고를 붙입니다([non-taxable-limits](../../reference/rules/non-taxable-limits.md#서버-이전-시-주의)) |
| 2 | 회사 한도와 법정 한도 중 작은 값 | **따름** | 회사가 법정보다 크게 잡아도 법정 한도를 넘는 비과세는 성립하지 않습니다. 법정 한도는 직원 한 명의 그달 유형별 합계이고, 회사 한도는 항목마다 그 항목에만 씁니다(같은 유형의 다른 항목 회사 한도를 무시하지 않습니다) |

**바뀌는 케이스:** 없음.

## overtime-multipliers

규칙: [overtime-multipliers.md](../../reference/rules/overtime-multipliers.md)

| # | 질문 | 결정 | 근거 |
|---|---|---|---|
| 1 | 고정 연장근로를 넘는 시간의 차액 지급 | **보류:** 아직 지원하지 않습니다. 실제 연장 시간만 받습니다 | 현행 `actual`/`additional` 입력의 동작을 확인하지 못했습니다 |
| 2 | 주휴 환산을 4.345주로 할까요, 실제 주 수로 할까요 | **바꿈:** 행 입력의 주휴 주 수(`weeklyHolidayWeeks`)를 그대로 쓰고, 시간은 분 단위 정수로 받습니다 | 소수 시간과 둘째 자리 반올림을 없애 엔진이 정수만 다루게 합니다 ([엔진](../payroll.md#계산-엔진)) |

**바뀌는 케이스**

- 근무 시간 입력: 소수 시간(`1.5`) → 분(`90`) (질문 2). 픽스처는 분으로 옮겼고 금액 기대값은 같습니다
- 배수 입력: `fixed_*_multiplier_x100`(150) → ppm(1500000)

## wage-proration

규칙: [wage-proration.md](../../reference/rules/wage-proration.md)

| # | 질문 | 결정 | 근거 |
|---|---|---|---|
| 1 | 역일 기준과 소정근로일 기준 | **보류:** 역일(`CALENDAR_DAYS`)을 기본으로 하고 `SCHEDULED_DAYS`도 받습니다 | 현행 제품의 선택을 확인하지 못했습니다. 정기 대장을 만들 때 HR 입·퇴사일로 기본 일할 입력을 넣는 것은 확정입니다 |

**바뀌는 케이스:** 없음.

## minimum-wage-warning

규칙: [minimum-wage-warning.md](../../reference/rules/minimum-wage-warning.md)

| # | 질문 | 결정 | 근거 |
|---|---|---|---|
| 1 | 막지 않고 경고만 할까요 | **따름:** `BELOW_MINIMUM_WAGE` 경고만 합니다 | 수습·감시단속 같은 예외를 서버가 모두 알 수 없습니다 |
| 2 | 수습 감액 90% | **보류:** 적용하지 않습니다 | HR이 수습 기간과 단순노무 여부를 주지 않습니다 |

**바뀌는 케이스:** 없음.

## severance-pay

규칙: [severance-pay.md](../../reference/rules/severance-pay.md)

| # | 질문 | 결정 | 근거 |
|---|---|---|---|
| 1 | 퇴직소득 공제표 | **따름:** 기준표 값 그대로입니다 | 소득세법 제48조제1항제1호(근속연수공제)·제2호(환산급여공제) 원문과 같습니다 |
| 2 | 퇴직금을 퇴사월 대장 행으로 넣을까요, 원천세 A21에 언제 넘길까요 | **보류:** 정산 리소스로 따로 두고 대장에도 원천세 집계에도 넣지 않습니다 | Tax와 함께 정해야 합니다 ([열린 질문](../payroll.md#열린-질문)) |
| 3 | 3개월 중 휴직 기간 제외 | **따름:** 현행처럼 빼지 않습니다 | HR 포트가 휴직 기간을 주게 되면 바꿉니다 |

**바뀌는 케이스:** 없음. 상태가 `in_progress` → `CALCULATED`로 이름만 바뀝니다.

## payroll-ledger-transitions

규칙: [payroll-ledger-transitions.md](../../reference/rules/payroll-ledger-transitions.md)

| # | 질문 | 결정 | 근거 |
|---|---|---|---|
| 1 | BPO 상태 문자열과 n/3 단계 | **바꿈:** `DRAFT`·`SUBMITTED`·`PENDING_APPROVAL`·`CLOSED` 네 상태와 응답의 `step`(1~3, "정산 진행 (n/3)"의 n)으로 둡니다. 명세서 발송·내보내기는 상태가 아닙니다 | BPO와 직접 운영이 같은 애그리거트를 쓰고 운영 방식(`workflow`)만 다릅니다 |
| 2 | 고객 "검토 요청" 엔드포인트 | **바꿈:** `:submit` 하나로 받습니다 | legacy 계산 요청과 BPO 검토 요청이 같은 전이입니다 |
| 3 | `cancel-approval`의 뜻 | **바꿈:** 담당자의 요청 철회(`:withdraw-approval-request`, 승인 대기 → 제출)와 마감 해제(`:reopen`, 마감 → 제출)로 나눕니다 | 대상 상태가 다른 두 일을 한 커맨드로 두면 원천세 잠금을 판정할 수 없습니다 |
| 4 | 반려에 사유를 받을까요 | **바꿈:** `:reject`와 `:reopen`은 `reason`이 필수입니다 | 담당자가 무엇을 고칠지 알아야 하고, 마감 해제는 감사 대상입니다 |

**바뀌는 케이스**

- 상태 이름: `입력가능`·`계산중`·`완료`, BPO 상태 문자열 → 네 상태 (질문 1)
- 오류 코드: `TRANSITION_INVALID` → 409 `PAYROLL_LEDGER_TRANSITION_INVALID`, `WITHHOLDING_FILED` → 409 `WITHHOLDING_FILED`
- `reject` 본문 없음 → 400 (질문 4)

## additional-payroll-ledger

규칙: [additional-payroll-ledger.md](../../reference/rules/additional-payroll-ledger.md)

| # | 질문 | 결정 | 근거 |
|---|---|---|---|
| 1 | 매뉴얼 예시(9월 10일 → 8월 5일)와 "5일 전"의 모순 | **따름:** 재설계 전 구현처럼 9월 5일부터 막습니다 | 예시는 귀속월과 지급월을 섞은 오기로 봅니다 |
| 2 | "5일 전"에 다섯째 날이 포함될까요 | **따름:** 마감일 − 5일 당일부터 막습니다 | 재설계 전 구현과 같습니다 |

**바뀌는 케이스:** 없음. 오류가 409 `ADDITIONAL_LEDGER_BLOCKED`(`reason`)와 409 `WITHHOLDING_FILED`로 나뉩니다.

## duplicate-wage-income

규칙: [duplicate-wage-income.md](../../reference/rules/duplicate-wage-income.md)

| # | 질문 | 결정 | 근거 |
|---|---|---|---|
| 1 | 같은 달 대장 두 개에서 근로소득 중복을 어떻게 막을까요 | **바꿈:** 서버가 회사·귀속월·직원마다 근로 행 하나만 받습니다. 두 번째는 409 `WAGE_INCOME_DUPLICATED`(`ledgerId`) | 간이세액은 월 급여 전체로 계산해야 맞습니다 |
| 2 | 근로소득이 있는 상여 대장 | **따름:** 받지 않습니다. 근로소득은 정기 대장에서만 입력합니다 | 매뉴얼이 "기본 급여카드에서만 입력"이라고 합니다 |

**바뀌는 케이스:** 없음. 현행에 서버 판정이 없던 규칙이라 픽스처가 곧 서버 기대값입니다.

## withholding-ledger-closed

규칙: [withholding-ledger-closed.md](../../reference/rules/withholding-ledger-closed.md)

| # | 질문 | 결정 | 근거 |
|---|---|---|---|
| 1 | 원천세 신고 코드(A01·A03·A25·A40) 매핑 | **바꿈:** 급여는 소득 종류(`WAGE`·`DAILY`·`BUSINESS`·`OTHER`)로 집계해 이벤트에 싣고, Tax가 코드로 바꿉니다 | 신고서 서식은 Tax의 지식입니다 |
| 2 | 대장이 없는 달을 마감으로 볼까요 | **따름:** 마감이 아닙니다 | 지급이 없는 달은 Tax가 무실적 신고로 따로 처리합니다. 자동 "제출됨"은 확인 기회를 없앱니다 |

**바뀌는 케이스:** 연계 방식이 Tax의 조회에서 `payroll_pay_month.closed`·`reopened` 이벤트로 바뀝니다. 판정 결과는 같습니다.

## 구현 상태

| 규칙 | 구현 | 픽스처 테스트 | 옮기지 않은 케이스 |
|---|---|---|---|
| [social-insurance-premiums](#social-insurance-premiums) | [social-insurance.ts](../../../apps/api/src/modules/payroll/engine/social-insurance.ts) | [engine.fixtures.test.ts](../../../apps/api/src/modules/payroll/engine/engine.fixtures.test.ts) | 없음 |
| [simple-income-tax](#simple-income-tax) | [wage-income-tax.ts](../../../apps/api/src/modules/payroll/engine/wage-income-tax.ts) | 같음 | 없음 |
| [daily-worker-withholding](#daily-worker-withholding) | [withholding.ts](../../../apps/api/src/modules/payroll/engine/withholding.ts) | 같음 | 없음 |
| [business-income-withholding](#business-income-withholding) | [withholding.ts](../../../apps/api/src/modules/payroll/engine/withholding.ts) | 같음 | 없음 |
| [other-income-withholding](#other-income-withholding) | [withholding.ts](../../../apps/api/src/modules/payroll/engine/withholding.ts) | 같음 | 없음 |
| [non-taxable-limits](#non-taxable-limits) | [non-taxable.ts](../../../apps/api/src/modules/payroll/engine/non-taxable.ts) | 같음 | 없음 |
| [overtime-multipliers](#overtime-multipliers) | [working-time.ts](../../../apps/api/src/modules/payroll/engine/working-time.ts), [payroll-row.ts](../../../apps/api/src/modules/payroll/engine/payroll-row.ts) | 같음 | 없음 |
| [wage-proration](#wage-proration) | [working-time.ts](../../../apps/api/src/modules/payroll/engine/working-time.ts) | 같음 | 없음 |
| [minimum-wage-warning](#minimum-wage-warning) | [working-time.ts](../../../apps/api/src/modules/payroll/engine/working-time.ts) | 같음 | 없음 |
| [severance-pay](#severance-pay) | [severance-pay.ts](../../../apps/api/src/modules/payroll/engine/severance-pay.ts) | 같음 | 없음 |
| [payroll-ledger-transitions](#payroll-ledger-transitions) | [ledger-status.ts](../../../apps/api/src/modules/payroll/ledgers/ledger-status.ts) | [ledger.fixtures.test.ts](../../../apps/api/src/modules/payroll/ledgers/ledger.fixtures.test.ts) | 없음 |
| [additional-payroll-ledger](#additional-payroll-ledger) | [ledger-rules.ts](../../../apps/api/src/modules/payroll/ledgers/ledger-rules.ts) | 같음 | 없음 |
| [duplicate-wage-income](#duplicate-wage-income) | [ledger-rules.ts](../../../apps/api/src/modules/payroll/ledgers/ledger-rules.ts) | 같음 | 없음 |
| [withholding-ledger-closed](#withholding-ledger-closed) | [pay-month.ts](../../../apps/api/src/modules/payroll/ledgers/pay-month.ts) | 같음 | 없음 |
