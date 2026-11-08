# 업무 개념 용어집

이 저장소를 읽는 데 필요한 세무·급여·노무·기장 개념을 영역별로 풀었습니다. 각 설계 문서의 `## 용어` 표는 "업무 용어 → 코드 이름" 대응이고, 이 문서는 그 업무 용어가 현실에서 무엇인지를 설명합니다. 코드 이름은 각 문서의 용어 표를 보세요. 아래에 나오는 코드 이름은 개념이 모델링된 곳을 가리키는 길잡이이고, 번역의 단일 출처는 용어 표입니다. 둘이 다르면 용어 표가 맞습니다([코드의 용어](conventions.md#코드의-용어)).

- **뜻:** 한두 문장으로 줄였습니다. 정확한 정의는 법령 원문을 보아야 합니다
- **이 저장소에서:** 개념이 모델링된 설계 문서 절, 규칙 문서, 코드 파일입니다. 모델링하지 않은 개념은 그렇다고 적었습니다
- **근거:** 저장소의 규칙 문서·설계 문서가 이미 인용한 법령만 옮겼습니다. 인용이 없으면 비워 두었습니다. 금액·비율은 모두 링크한 문서에서 가져왔고, 2026년 기준표 값입니다. 법률 자문이 아니며 원문 확인이 필요하다는 점은 [compliance.md](compliance.md)와 같습니다

## 원천징수와 급여 계산

| 용어 | 뜻 | 이 저장소에서 | 근거 |
|---|---|---|---|
| 원천징수 | 소득을 지급하는 쪽(회사)이 지급할 때 세금을 떼어 두었다가 대신 신고·납부하는 제도입니다. 급여에서 떼는 소득세·지방소득세가 대표적입니다 | 급여 계산 엔진 [engine/](../../apps/api/src/modules/payroll/engine/)이 소득 종류별 세액을 계산하고, 납부는 Tax의 원천세 신고 건(`WITHHOLDING_TAX`)이 맡습니다 ([payroll.md](payroll.md#계산-엔진), [tax.md](tax.md#신고-건)) | 소득세법 제128조 ([compliance.md](compliance.md#신고와-원천징수)) |
| 귀속월과 지급월 | 귀속월은 그 급여가 어느 달 근로의 대가인지, 지급월은 실제로 돈을 준 달입니다. 원천세는 지급 시기 기준이라 지급월로 묶습니다 | 4대보험·최저임금은 귀속월 기준표, 원천세는 지급월 기준표를 씁니다. 원천세 신고 건은 대장의 지급월로 찾습니다 ([payroll.md](payroll.md#기준표), [withholding-ledger-closed](../reference/rules/withholding-ledger-closed.md)) | |
| 근로소득 간이세액표 | 매달 급여에서 뗄 소득세를 월 급여와 공제대상 가족 수로 찾는 표입니다. 연말정산 전에 미리 떼는 "대략의" 세액입니다 | 엔진은 표 대신 산식으로 계산합니다. 300만원·1인에 공식 표는 74,350원, 산식은 60,380원이라 차이를 미확인(D4)으로 남겼습니다 ([simple-income-tax](../reference/rules/simple-income-tax.md), [payroll.md 열린 질문 1](payroll.md#열린-질문)) | 소득세법 시행령 별표 2 ([simple-income-tax](../reference/rules/simple-income-tax.md#원문-확인-2026-11-05)) |
| 원천징수 비율 | 근로자가 간이세액의 80·100·120% 중에서 고르는 비율입니다. 매달 덜 떼고 연말정산 때 더 낼지, 그 반대일지를 고릅니다 | HR 소득세 공제 설정의 조정비율(ppm)로 받아 급여가 곱합니다 ([hr.md](hr.md#소득세-공제), [deduction-validation](../reference/rules/deduction-validation.md)) | |
| 공제대상 가족, 8~20세 자녀 | 간이세액표를 찾는 입력입니다. 본인을 포함한 공제대상 가족 수가 많을수록, 8~20세 자녀가 있을수록 세액이 줄어듭니다. 2026. 3월부터 자녀 1명 공제액은 20,830원입니다 | 인적공제 대상자에서 파생하는 읽기 전용 값이지만, 대상자 엔드포인트가 없어 지금은 공제 설정에 직접 입력합니다 ([dependant-count](../reference/rules/dependant-count.md), [simple-income-tax](../reference/rules/simple-income-tax.md#로직), [hr.md](hr.md#구현-상태)) | 소득세법 시행령 별표 2 제3호 ([simple-income-tax](../reference/rules/simple-income-tax.md#원문-확인-2026-11-05)) |
| 지방소득세 | 소득세에 따라붙는 지방세로, 원천징수 때 소득세의 10%를 함께 뗍니다(특별징수) | 소득 종류마다 엔진이 소득세 × 10%로 계산합니다 ([simple-income-tax](../reference/rules/simple-income-tax.md)) | 지방회계법 제55조(10원 미만 절사) ([simple-income-tax](../reference/rules/simple-income-tax.md#원문-확인-2026-11-05)) |
| 절사와 소액부징수 | 세액·보험료의 끝수를 버리는 규칙과, 소득세가 1,000원 미만이면 아예 걷지 않는 규칙입니다 | 대상별 절사 단위 표가 [payroll.md](payroll.md#절사)에 있습니다. 소액부징수는 일용·사업·기타소득에 씁니다 ([daily-worker-withholding](../reference/rules/daily-worker-withholding.md), [business-income-withholding](../reference/rules/business-income-withholding.md)) | 국고금관리법 제47조제1항(10원 미만 절사) ([simple-income-tax](../reference/rules/simple-income-tax.md#원문-확인-2026-11-05)) |
| 비과세 소득 | 법이 세금을 매기지 않는 급여 항목입니다. 식대(월 200,000원)처럼 유형마다 한도가 있고, 한도를 넘는 금액은 과세 급여가 됩니다 | 기준표의 `nonTaxable` 한도와 회사 한도 중 작은 쪽을 쓰고, 넘으면 `NON_TAXABLE_LIMIT_EXCEEDED` 경고를 붙입니다. 10개 유형 표가 [non-taxable-limits](../reference/rules/non-taxable-limits.md)에 있습니다 | 소득세법 제12조, 같은 법 시행령 제12조·제16조·제17조 등 ([non-taxable-limits](../reference/rules/non-taxable-limits.md#로직)) |
| 보육수당 비과세 | 6세 이하 자녀의 보육 관련 급여를 비과세로 보는 항목입니다. 2026년 지급분부터 자녀 1명당 월 20만원입니다 | HR의 `childcareChildrenCount`를 급여 행 스냅숏에 복사해 한도를 곱합니다. 모르면 1명으로 보고 경고합니다 ([payroll.md](payroll.md#다른-컨텍스트와의-연결), [hr.md](hr.md#소득세-공제)) | 소득세법 제12조제3호머목2) ([non-taxable-limits](../reference/rules/non-taxable-limits.md#서버-이전-시-주의)) |
| 일용근로소득 | 날마다 고용되어 일당을 받는 근로자의 소득입니다. 하루 일당에서 15만원을 빼고 6%를 곱한 뒤 55%를 세액공제해 떼고, 4대보험은 기본으로 고용보험만 뺍니다 | 대장 행의 `DAILY` 소득 종류입니다. 추가 대장에도 넣을 수 있습니다 ([daily-worker-withholding](../reference/rules/daily-worker-withholding.md), [payroll.md](payroll.md#추가-대장과-근로소득-중복)) | |
| 사업소득 원천징수 | 프리랜서처럼 고용되지 않은 개인에게 용역 대가를 줄 때 지급액의 3%(지방소득세 포함 3.3%)를 떼는 것입니다 | 대장 행의 `BUSINESS` 소득 종류입니다. 업종코드 40개는 지급명세서 서식의 표를 따릅니다 ([business-income-withholding](../reference/rules/business-income-withholding.md), [reference-codes.ts](../../apps/api/src/modules/payroll/rate-tables/reference-codes.ts)) | 소득세법 시행규칙 별지 제23호서식(2) ([business-income-withholding](../reference/rules/business-income-withholding.md#서버-이전-시-주의)) |
| 기타소득 원천징수 | 강연료처럼 일시적인 소득에서 필요경비를 뺀 금액의 20%를 떼는 것입니다. 지급사유마다 법이 정한 의제 경비율(예: 60%)이 있고, 기타소득금액이 5만원 이하면 과세하지 않습니다(과세최저한) | 대장 행의 `OTHER` 소득 종류입니다. 지급사유 코드는 지급명세서 서식의 소득구분코드입니다 ([other-income-withholding](../reference/rules/other-income-withholding.md), [rule-decisions/payroll.md](rule-decisions/payroll.md#other-income-withholding)) | 소득세법 제129조, 같은 법 시행규칙 별지 제23호서식(4) ([payroll.md](payroll.md#검증된-규칙과-미확인-규칙), [other-income-withholding](../reference/rules/other-income-withholding.md#서버-이전-시-주의)) |
| 중소기업 취업자 소득세 감면 | 중소기업에 취업한 청년 등의 근로소득세를 일정 기간 줄여 주는 제도입니다. 청년 90%, 고령자·장애인·경력단절여성 70%, 과세기간 200만원 한도입니다 | 근로 행 입력의 감면율(`reduction.ratePpm`)이고, 감면 사유표는 [income-tax-reduction-reasons.ts](../../apps/api/src/modules/hr/tax-withholding/income-tax-reduction-reasons.ts)에 있습니다. 2026. 12. 31.까지 취업한 사람만 대상이라 2027 기준표 때 다시 확인합니다 ([payroll.md 열린 질문 9](payroll.md#열린-질문)) | 조세특례제한법 제30조제1항 ([simple-income-tax](../reference/rules/simple-income-tax.md#서버-이전-시-주의)) |

## 4대보험

| 용어 | 뜻 | 이 저장소에서 | 근거 |
|---|---|---|---|
| 4대보험 | 국민연금·건강보험(장기요양보험 포함)·고용보험·산재보험입니다. 산재보험은 사업주만 내고, 나머지는 근로자와 사업주가 나눠 냅니다. 2026년 근로자 몫은 국민연금 4.75%, 건강보험 3.595%, 장기요양 건강보험료의 13.14%, 고용보험 0.9%입니다 | 요율은 코드가 아니라 적용 시작월이 있는 기준표(`RateTable`)에 있습니다. 급여 설정의 산출방법으로 요율 계산(`RATE`)과 공단 고지액(`NOTICE`) 중 하나를 고릅니다 ([social-insurance-premiums](../reference/rules/social-insurance-premiums.md), [rate-tables-2026.ts](../../apps/api/src/modules/payroll/engine/rate-tables-2026.ts)) | 국민연금법 부칙, 국민건강보험법 시행령 제44조, 노인장기요양보험법 제9조, 보험료징수법 시행령 제12조 ([social-insurance-premiums](../reference/rules/social-insurance-premiums.md#원문-확인-2026-11-05)) |
| 기준소득월액과 상하한 | 국민연금 보험료를 매기는 월 소득입니다. 1,000원 미만을 버리고 상한·하한 안으로 자릅니다. 2026. 7월부터 하한 410,000원, 상한 6,590,000원입니다 | 상하한이 바뀌는 달마다 기준표 버전을 둡니다(2026-07) ([social-insurance-premiums](../reference/rules/social-insurance-premiums.md#로직), [payroll.md](payroll.md#기준표)) | 국민연금법 시행령 제5조제1항, 보건복지부고시 제2026-31호 ([social-insurance-premiums](../reference/rules/social-insurance-premiums.md#원문-확인-2026-11-05)) |
| 4대보험 자격 판정 | 나이·근로시간·임원 여부·체류자격으로 가입 대상인지 가리는 일입니다. 예: 60세 이상은 국민연금, 65세 이후 새로 고용되면 고용보험에서 빠지고, 주 15시간 미만은 국민연금·건강·고용보험에서 빠집니다 | `:determine`이 저장하지 않는 권장값을 돌려줍니다. 급여는 판정 결과만 받습니다 ([hr.md](hr.md#4대보험-설정과-자격-판정), [social-insurance-eligibility](../reference/rules/social-insurance-eligibility.md)) | |
| 취득·상실·휴직·복직·피부양자 신고 | 입사하면 자격 취득, 퇴사하면 자격 상실, 휴직·복직이나 건강보험 피부양자 등록이 생기면 공단에 신고합니다 | 직원 등록·퇴사·휴직·복직이 `InsuranceFiling`을 `PENDING`으로 엽니다. 처리 커맨드와 목록은 아직 없고, 처리 주체는 세무 대리인으로 두었습니다 ([hr.md](hr.md#4대보험-신고)) | |
| 국민연금 납부예외, 건강보험 납입고지유예 | 휴직처럼 소득이 없는 기간에 보험료를 내지 않거나 미루는 신청입니다 | 휴직의 `npsPaymentException`·`nhisNoticeDeferral` 옵션이 휴직 신고 내용에 들어갑니다 ([hr.md](hr.md#휴직), [leave-validation](../reference/rules/leave-validation.md)) | 국민건강보험법 시행규칙 제50조 ④ ([hr.md](hr.md#휴직)) |
| 예술인·노무제공자 고용보험 | 근로자가 아닌 예술인·노무제공자도 고용보험에 가입하며, 본인 몫은 0.8%입니다 | 사업소득 행에서 대상이라고 표시했을 때만 뺍니다. 필요경비를 빼지 않는 것은 학습용 가정입니다 ([business-income-withholding](../reference/rules/business-income-withholding.md)) | 보험료징수법 시행령 제56조의5제2항 ([business-income-withholding](../reference/rules/business-income-withholding.md#근거)) |

## 근로조건과 임금

| 용어 | 뜻 | 이 저장소에서 | 근거 |
|---|---|---|---|
| 최저임금 | 사용자가 지급해야 하는 임금의 최저선입니다. 2026년은 시간급 10,320원, 월 2,156,880원(209시간)입니다 | 급여 행은 미달이면 `BELOW_MINIMUM_WAGE` 경고만 붙이고 저장을 막지 않습니다. HR 급여계약은 같은 값을 기준표가 아닌 HR 상수로 비교합니다 ([minimum-wage-warning](../reference/rules/minimum-wage-warning.md), [hr.md 열린 질문 8](hr.md#열린-질문)) | 고용노동부고시 제2025-47호 ([minimum-wage-warning](../reference/rules/minimum-wage-warning.md#근거)) |
| 통상임금·통상시급 | 정기적·일률적으로 주는 임금으로, 가산수당과 퇴직금 하한의 기준입니다. 통상시급은 통상임금 포함 항목 월합계 ÷ 월 소정근로시간(근로자와 정한 근로시간, 주 40시간이면 유급 주휴를 포함해 209시간)입니다 | 엔진은 통상시급을 반올림하지 않고 분수로 들고 다닙니다 ([overtime-multipliers](../reference/rules/overtime-multipliers.md#로직), [payroll.md](payroll.md#절사)) | |
| 연장·야간·휴일 가산수당, 5인 미만 사업장 | 법정 근로시간을 넘거나 밤·휴일에 일한 시간에 통상임금보다 더 주는 수당입니다. 5인 이상 기본 배수는 연장 1.5, 야간 0.5(가산분), 휴일 1.5, 휴일연장 2이고, 상시 근로자 4명 이하 사업장은 가산 규정이 적용되지 않아 가산이 없습니다 | 배수는 회사 설정(`multipliers`, ppm)이고 `underFiveEmployees`를 바꾸면 기본 배수도 바뀝니다. HR 급여계약은 아직 회사 규모를 읽지 않습니다 ([overtime-multipliers](../reference/rules/overtime-multipliers.md), [payroll.md](payroll.md#급여-설정), [hr.md 열린 질문 3](hr.md#열린-질문)) | 근로기준법 제56조, 제11조 ②, 같은 법 시행령 제7조 별표 1 ([hr.md 열린 질문 3](hr.md#열린-질문)) |
| 주휴수당 | 1주 소정근로일을 채운 근로자에게 주는 유급 휴일 1일치 임금입니다. 1일 주휴시간은 주 소정근로시간 ÷ 40 × 8(최대 8시간)이고 주 15시간 미만이면 없습니다 | 월급제는 기본급에 들어 있다고 보고, 시급·일급제만 따로 계산합니다 ([overtime-multipliers](../reference/rules/overtime-multipliers.md)) | |
| 일할계산 | 월 중간에 입사하거나 퇴사한 사람의 월급을 근무한 날만큼 나누는 계산입니다 | 정기 대장을 만들 때 서버가 역일 기준 일할 입력을 넣습니다 ([wage-proration](../reference/rules/wage-proration.md), [payroll.md](payroll.md#급여대장)) | |
| 수습 감액 | 수습 기간 동안 임금을 줄여 주는 것입니다. 1년 이상 계약에만 허용하고 단순노무 직종은 받지 않습니다 | 근로계약 `probation`과 검증 규칙입니다. 급여의 최저임금 경고는 아직 감액을 반영하지 않습니다 ([work-contract-validation](../reference/rules/work-contract-validation.md), [hr.md](hr.md#근로계약), [payroll.md 열린 질문 13](payroll.md#열린-질문)) | |
| 기간제와 무기계약 전환 | 기간을 정한 근로계약이 이어져 2년을 넘으면 기간의 정함이 없는 근로계약으로 보는 제도입니다. 만 55세 이상 등 예외가 있습니다 | 직원 경고 `INDEFINITE_CONVERSION_TARGET`과 전환 조회입니다 ([indefinite-conversion-alert](../reference/rules/indefinite-conversion-alert.md), [hr.md](hr.md#근로계약)) | 기간제법 제4조 ([hr.md](hr.md#근로계약)) |
| 근로계약서 서면 교부와 보존 | 근로조건을 서면으로 명시해 주고 계약 서류를 3년 보존해야 합니다 | 서명 완료 문서와 서명 증적을 지우지 않고 고정합니다 ([compliance.md](compliance.md#근로계약서와-임금명세서), [documents.md](documents.md#전자서명-요청)) | 근로기준법 제17조, 제42조 ([compliance.md](compliance.md#근로계약서와-임금명세서)) |
| 임금명세서 | 임금을 줄 때 구성항목·계산방법·공제내역을 적어 근로자에게 주는 문서입니다 | `Payslip`은 마감된 대장 행의 보기이고, 발송 기록만 따로 저장합니다. 받는 주소는 행의 소득자 사본(`earner.email`)이라 직원이 아닌 일용·사업·기타소득자도 받습니다 ([payroll.md](payroll.md#급여명세서)) | 근로기준법 제48조제2항 ([compliance.md](compliance.md#근로계약서와-임금명세서)) |
| 휴직(출산전후휴가·육아휴직) | 근로관계를 유지한 채 일정 기간 일을 쉬는 것입니다. 육아휴직은 근속에 항상 포함합니다 | `Leave`와 `:return`입니다. 육아휴직 누적 365일 초과는 막지 않고 경고합니다 ([hr.md](hr.md#휴직), [leave-validation](../reference/rules/leave-validation.md)) | |

## 퇴직과 퇴직금

| 용어 | 뜻 | 이 저장소에서 | 근거 |
|---|---|---|---|
| 퇴직급여 제도(퇴직금·DB·DC) | 퇴직금은 회사가 퇴직 때 직접 주는 방식, DB·DC는 퇴직연금입니다. 퇴직금 정산은 퇴직금 제도 직원만 대상입니다 | HR `retirementPlan.benefitType`입니다. HR에 아직 이 정보가 없어 급여는 언제나 퇴직금으로 봅니다 ([hr.md](hr.md#용어), [payroll.md](payroll.md#구현-상태)) | |
| 퇴직금 | 계속근로 1년 이상, 4주 평균 주 15시간 이상 일한 근로자가 퇴직할 때 받는 돈으로, 평균임금 30일분 × 재직일수 ÷ 365입니다 | `SeveranceSettlement`와 엔진 [severance-pay.ts](../../apps/api/src/modules/payroll/engine/severance-pay.ts)입니다. 엔진은 재직 1년 미만이면 0으로 계산하고, 주 15시간 요건은 판정하지 않습니다 ([severance-pay](../reference/rules/severance-pay.md#근거)의 스펙 4.11 인용, [payroll.md](payroll.md#퇴직금-정산)) | |
| 평균임금 | 퇴직일 전 3개월 동안 받은 임금 총액을 그 기간 일수로 나눈 하루 임금입니다. 통상임금보다 낮으면 통상임금을 씁니다 | 3개월 임금은 입력이 없으면 그 직원의 마감된 대장 행에서 가져옵니다 ([payroll.md](payroll.md#퇴직금-정산), [severance-pay](../reference/rules/severance-pay.md#로직)) | |
| 퇴직소득세, 근속연수공제, 환산급여공제 | 퇴직금에 매기는 세금입니다. 근속연수(1년 미만 끝수는 올림)에 따른 근속연수공제를 빼고, 연 단위로 환산한 환산급여(`(퇴직소득 − 근속연수공제) × 12 ÷ 근속연수`)에서 환산급여공제를 뺀 뒤 기본세율을 매기고, `× 근속연수 ÷ 12`로 되돌려 10원 미만을 버립니다. 지방소득세는 그 10%입니다 | 퇴직월 기준표의 `retirementIncomeTax`(`serviceYearDeduction`, `convertedPayDeduction`)를 엔진 [severance-pay.ts](../../apps/api/src/modules/payroll/engine/severance-pay.ts)의 `retirementIncomeTax`가 씁니다 ([severance-pay](../reference/rules/severance-pay.md#로직), [rate-tables-2026.ts](../../apps/api/src/modules/payroll/engine/rate-tables-2026.ts)) | 소득세법 제48조제1항제1호(근속연수공제)·제2호(환산급여공제) ([severance-pay](../reference/rules/severance-pay.md#서버-이전-시-주의), [rate-tables-2026.ts](../../apps/api/src/modules/payroll/engine/rate-tables-2026.ts)) |
| 퇴직금 지급일 | 퇴직금은 퇴직 뒤 14일 안에 주며, 퇴직월과 다른 달에 줄 수 있습니다. 원천세는 지급한 달에 셉니다 | 정산의 `paymentDate`가 속한 달의 원천세 A21로 셉니다(2026-11-07 결정). 이벤트에 싣는 것은 아직입니다 ([payroll.md](payroll.md#퇴직금-정산)) | |

## 원천세 신고

| 용어 | 뜻 | 이 저장소에서 | 근거 |
|---|---|---|---|
| 원천징수이행상황신고 | 그달 원천징수한 세액을 소득 종류별로 모아 신고·납부하는 것입니다. 신고서 줄마다 코드가 있습니다(A01 근로 간이세액, A03 일용근로, A04 연말정산, A21~A22 퇴직, A25 사업소득, A40~ 기타소득) | 급여는 코드를 모르고 소득 종류(`WAGE`·`DAILY`·`BUSINESS`·`OTHER`)로 집계하며 코드 변환은 Tax 몫으로 두었습니다. Tax의 변환은 아직 없습니다 ([spec 6.1절](../reference/spec/payroll.md), [rule-decisions/payroll.md](rule-decisions/payroll.md#withholding-ledger-closed), [payroll-events.types.ts](../../apps/api/src/modules/payroll/ports/payroll-events.types.ts)) | |
| 매월 납부와 반기 납부 | 원천세는 지급한 달의 다음 달 10일까지 내는 것이 원칙이고, 반기 납부를 하는 회사는 반기(1–6월분은 7월 10일, 7–12월분은 다음 해 1월 10일)로 모아 냅니다 | 세무 설정 `withholdingCycle`과 신고 종류 `MONTHLY`·`SEMIANNUAL`입니다 ([filing-obligations](../reference/rules/filing-obligations.md#로직), [tax.md](tax.md#용어)) | |
| 급여대장 마감 연계 | 원천세 신고 자료 중 "이번 지급월 급여대장이 확정됐는가"를 자동으로 채우는 항목입니다 | 지급월 대장이 하나 이상이고 모두 `CLOSED`면 `PAYROLL_LEDGER_CLOSED` 항목이 `PROVIDED`가 됩니다. 급여 플랜 회사에만 넣습니다 ([withholding-ledger-closed](../reference/rules/withholding-ledger-closed.md), [tax.md](tax.md#제출-자료)) | |
| 원천세 신고 잠금 | 원천세를 신고한 지급월의 급여 금액이 바뀌면 신고와 어긋나므로 막는 규칙입니다. 고치려면 수정신고를 거쳐야 합니다 | 신고 건이 `FILED`·`SETTLED`면 대장의 금액 변경 커맨드가 409 `WITHHOLDING_FILED`입니다. 수정신고는 아직 없습니다 ([payroll.md](payroll.md#원천세-신고-잠금), [tax.md 열린 질문 4](tax.md#열린-질문)) | |
| 지급명세서·간이지급명세서 | 누구에게 얼마를 주고 얼마를 뗐는지 사람별로 적어 세무서에 내는 서류입니다 | 서류 자체는 모델링하지 않았습니다. 나중에 다시 만들 수 있도록 대장의 행 단위 원본을 마감 뒤에도 보존한다는 설계만 있습니다 ([compliance.md](compliance.md#신고와-원천징수), [daily-worker-withholding](../reference/rules/daily-worker-withholding.md#서버-이전-시-주의)) | 소득세법 제164조, 제164조의3 ([compliance.md](compliance.md#신고와-원천징수)) |
| 연말정산 | 한 해 동안 간이세액표로 뗀 근로소득세를 실제 공제 항목으로 다시 계산해 차액을 돌려주거나 더 걷는 절차입니다 | 따로 모델링하지 않았습니다. 2월분 근로소득을 줄 때 원천징수하므로 2월분 원천세(3월 10일)에 들어간다고 보고 일정에 따로 넣지 않았습니다. 인적공제 대상자는 규칙만 있습니다 ([rule-decisions/tax.md](rule-decisions/tax.md#filing-obligations), [hr.md](hr.md#인적공제-대상자)) | 소득세법 제137조 ① ([rule-decisions/tax.md](rule-decisions/tax.md#filing-obligations)) |

## 부가세·법인세·종합소득세

| 용어 | 뜻 | 이 저장소에서 | 근거 |
|---|---|---|---|
| 세목과 신고 건 | 세목은 세금의 종류(부가세·원천세·법인세·종합소득세)이고, 신고 건은 한 세목의 한 기간에 대한 신고 한 번입니다 | `Filing`의 `taxType`·`kind`·`periodKey`입니다 ([tax.md](tax.md#신고-건)) | |
| 부가세 과세기간, 예정·확정 신고 | 부가세는 반기(1–6월, 7–12월)마다 신고합니다. 앞 3개월(1–3월, 7–9월)을 예정으로 신고하고, 확정 신고는 예정 신고를 했으면 나머지 3개월, 아니면 반기 전체를 다룹니다. 기한은 기간 다음 달 25일입니다 | 법인이 예정 신고 방식일 때만 예정 신고 건을 만들고, 그 밖에는 예정고지 건을 만듭니다 ([filing-obligations](../reference/rules/filing-obligations.md#로직), [filing-obligations.ts](../../apps/api/src/modules/tax/calendar/filing-obligations.ts)) | 부가가치세법 제5조 ① ([rule-decisions/tax.md](rule-decisions/tax.md#filing-obligations)) |
| 예정고지 | 예정 신고 대신 세무서가 직전 기 납부세액의 50%를 고지하는 방식입니다. 50만원 미만이면 고지하지 않습니다. 개인 일반과세자와 작은 법인이 원칙적으로 받습니다 | 신고 종류 `NOTICE`이고, 자료 요청·검토 없이 대리인이 고지서를 붙이는 `:record-notice`로 바로 `FILED`가 됩니다 ([tax.md](tax.md#용어), [tax.md](tax.md#상태)) | |
| 간이과세자 | 일반과세자와 다른 방식으로 부가세를 내는 개인사업자 유형입니다. 1년이 과세기간이고 1–6월분은 예정부과(7월 25일), 확정 신고는 다음 해 1월 25일입니다 | 세무 설정 `vatTaxpayerType: SIMPLIFIED`(개인만)로 일정을 계산하지만, 설정 저장소가 없어 지금은 언제나 일반과세자입니다 ([rule-decisions/tax.md](rule-decisions/tax.md#filing-obligations), [tax.md 열린 질문 6](tax.md#열린-질문)) | 부가가치세법 제66조 ①·③, 제67조 ① ([rule-decisions/tax.md](rule-decisions/tax.md#filing-obligations)) |
| 매출세액·매입세액·환급 | 부가세 납부세액은 매출 때 받은 세액에서 매입 때 낸 세액을 뺀 것입니다. 음수면 돌려받습니다(환급) | 예상 부가세는 수집한 증빙으로 이 차이를 계산하고, 매입은 공제로 분류된 것만 셉니다 ([estimated-vat](../reference/rules/estimated-vat.md), [tax.md](tax.md#예상-부가세)) | |
| 매입매출장 | 과세기간의 매출·매입 거래를 모은 장부로, 부가세 신고의 바탕입니다 | 대리인이 파일로 올리는 신고 건 문서(`LEDGER`)이고 고객이 확인하거나 이의를 답니다. 수집한 증빙에서 자동으로 만들지는 않습니다 ([tax.md](tax.md#문서), [tax.md](tax.md#커맨드)) | |
| 중간예납 | 법인세·종합소득세를 한 해 중간에 미리 내는 것입니다 | 법인은 신고 종류 `INTERIM`, 개인은 종합소득세의 `NOTICE`(11월 30일)입니다 ([rule-decisions/tax.md](rule-decisions/tax.md#filing-obligations)) | 법인세법 제63조, 소득세법 제65조 ① ([rule-decisions/tax.md](rule-decisions/tax.md#filing-obligations)) |
| 법인세·종합소득세 신고, 성실신고확인 | 법인세는 사업연도 종료 월 말일부터 3개월, 종합소득세는 다음 해 5월 31일이 기한이고, 성실신고확인 대상이면 한 달 늦습니다 | 세무 일정이 결산월과 `sincereFilingTarget`으로 계산합니다. 두 세목은 제출 자료 체크리스트가 없습니다 ([filing-obligations](../reference/rules/filing-obligations.md#로직), [tax.md 열린 질문 5](tax.md#열린-질문)) | |
| 신고 기한 이월 | 기한이 토요일·일요일·공휴일·근로자의 날이면 다음 날로 미룹니다 | 공휴일표로 기한을 미룹니다 ([filing-deadline-rollover](../reference/rules/filing-deadline-rollover.md), [filing-deadline.ts](../../apps/api/src/modules/tax/calendar/filing-deadline.ts)) | 국세기본법 제5조 ([filing-deadline-rollover](../reference/rules/filing-deadline-rollover.md)) |

## 증빙과 기장

| 용어 | 뜻 | 이 저장소에서 | 근거 |
|---|---|---|---|
| 기장 | 회사의 거래를 장부에 적는 일입니다. 이 저장소에서 "세무 기장"은 세무 대리인이 장부와 신고를 맡는 상품을 뜻합니다 | 플랜 `TAXATION`, 서비스 계약 `BOOKKEEPING`입니다 ([identity-access.md](identity-access.md#용어), [billing.md](billing.md#용어)) | |
| 증빙 | 거래가 있었음을 보여 주는 서류입니다. 세금계산서·현금영수증·카드 매출전표가 대표적입니다 | `Evidence`(`side`, `source`)입니다. 수집 반영과 세금계산서 발급(매출 증빙, `source: TAX_INVOICE`)으로 생기고, 직접 만들거나 지우는 엔드포인트는 없습니다 ([bookkeeping.md](bookkeeping.md#증빙), [bookkeeping.md](bookkeeping.md#거래명세서와-세금계산서-발급)) | |
| 장부·증빙 보존 | 장부와 증거서류는 법정신고기한이 지난 날부터 5년간 보존해야 합니다 | 증빙·입출금·세금계산서·지로 납부에는 삭제 API가 없습니다 ([compliance.md](compliance.md#장부와-증빙-보존)) | 국세기본법 제85조의3 ([compliance.md](compliance.md#장부와-증빙-보존)) |
| 거래명세서, 전자세금계산서와 수정세금계산서 | 거래명세서는 품목·수량·금액을 적어 상대에게 주는 서류이고, 세금계산서는 부가세 과세 거래에서 공급자가 발행해 국세청에 전송하는 계산서입니다. 발행한 세금계산서는 고치지 않고 수정세금계산서를 새로 발행합니다 | 거래명세서(`SalesTransaction`)를 홈택스로 발급(`POST /tax-invoices`)하면 승인번호로 매출 증빙을 바로 만들고 명세서는 잠깁니다. 수정세금계산서는 아직 없습니다 ([sales-statement-totals](../reference/rules/sales-statement-totals.md)) ([bookkeeping.md](bookkeeping.md#거래명세서와-세금계산서-발급), [compliance.md](compliance.md#장부와-증빙-보존)) | |
| 계정과목과 자동분류 | 계정과목은 거래를 성격별로 묶는 이름(예: 매출, 복리후생비)이고, 자동분류는 규칙으로 계정과목을 채우는 일입니다 | 기본 체계 54행과 회사 하위 계정, 규칙의 `FILL_EMPTY`·`OVERWRITE` 적용입니다. 사람이 분류한 행은 규칙이 건너뜁니다 ([bookkeeping.md](bookkeeping.md#계정과목), [classification-apply-mode](../reference/rules/classification-apply-mode.md)) | |
| 거래처와 미정산 금액 | 거래 상대방과, 분류된 증빙 중 아직 입출금과 맞추지 않은 금액입니다 | `Partner`와 `outstanding`. 같은 사업자번호의 증빙을 거래처에 잇습니다 ([bookkeeping.md](bookkeeping.md#거래처), [partner-outstanding-amount](../reference/rules/partner-outstanding-amount.md)) | |
| 증빙 연결(대사) | 통장 입출금 한 건이 어느 증빙의 대금인지 맞추는 일입니다 | `:link`로 맞추고 연결 상태는 읽을 때 계산합니다 ([bookkeeping.md](bookkeeping.md#증빙-연결-상태), [settlement-match-status](../reference/rules/settlement-match-status.md)) | |
| 사업자등록번호와 사업자 상태 | 10자리 사업자번호에는 검증 숫자가 있고, 국세청에서 계속·휴업·폐업 상태를 조회할 수 있습니다 | 번호 검증 규칙과 `GET /business-statuses/{businessNumber}`입니다 ([business-number-checksum](../reference/rules/business-number-checksum.md), [integrations.md](integrations.md#사업자-상태조회), [business-status-cache](../reference/rules/business-status-cache.md)) | |
| 지로 | 공과금·보험료 등을 금융결제원 인터넷지로로 내는 고지서입니다 | `Giro`와 `:pay`·`:mark-paid`·`:hide`입니다. 수집한 목록으로 상태를 다시 맞춥니다 ([bookkeeping.md](bookkeeping.md#지로-고지서), [giro-status-transitions](../reference/rules/giro-status-transitions.md)) | |

## 세무 대리인과 기관 연동

| 용어 | 뜻 | 이 저장소에서 | 근거 |
|---|---|---|---|
| 세무 대리인과 배정 | 회사의 세무를 맡은 세무사 사무소의 담당자와, 어느 담당자가 어느 회사를 맡는지의 관계입니다 | `AgencyAssignment`, 행위자 `kind: AGENCY`, 담당 회사를 가로지르는 `/agency/*` 큐입니다 ([identity-access.md](identity-access.md#용어), [agency-queue.md](agency-queue.md)) | 세무사법 (확인 필요, [compliance.md](compliance.md#권한-범위와-대리인)) |
| 수임 계약 | 회사가 세무 대리인에게 기장·신고 업무를 맡기는 계약입니다 | `ServiceContract` 조회만 있고, 계약을 맺는 흐름은 제안 상태입니다 ([billing.md](billing.md#서비스-계약), [billing.md](billing.md#상태)) | |
| 홈택스 수임동의 | 세무 대리인이 홈택스에 수임을 등록하면 대표자가 홈택스에서 동의하는 절차입니다. 동의해야 대리인이 그 회사 자료를 홈택스에서 볼 수 있습니다 | `HometaxDelegation`과 `:agree`입니다. 등록 쪽(데스크)은 범위 밖입니다 ([integrations.md](integrations.md#홈택스-수임동의)) | |
| 대리인 대행 | 고객이 할 일을 배정된 대리인이 대신 처리하는 것입니다 | 원천세의 `:submit`·`:unsubmit`·`:pay`만 대행할 수 있고 이력에 `onBehalfOf: CLIENT`를 남깁니다(2026-11-07 결정) ([tax.md](tax.md#커맨드)) | |
| 공동인증서 | 전자서명과 본인 확인에 쓰는 인증서입니다. 사업자 범용·전자세금용·은행용처럼 용도가 나뉘고, 명의가 사업자나 대표자와 맞아야 합니다 | `SigningCertificate`와 등록·사용 판정 [certificate-eligibility.ts](../../apps/api/src/modules/integrations/certificates/certificate-eligibility.ts)입니다 ([integrations.md](integrations.md#공동인증서), [certificate-eligibility](../reference/rules/certificate-eligibility.md)) | |
| 기관 연동과 수집(스크래핑) | 회사가 맡긴 홈택스·카드사·은행 등의 로그인 자격으로 서버가 거래 내역을 가져오는 일입니다 | `Integration`, `ScrapRequest`(사용자 요청 뒤 600초 쿨다운), 결과는 Bookkeeping의 `ScrapedRecordIngestion`으로 넘깁니다 ([integrations.md](integrations.md#수집-요청), [scrap-cooldown](../reference/rules/scrap-cooldown.md)) | 전자금융거래법 (확인 필요, [compliance.md](compliance.md#외부-기관-자격-증명)) |
| CMS 자동출금 | 고객 계좌에서 이용료를 정기적으로 빼 가는 출금 이체입니다. 출금일은 매달 25일이고 쉬는 날이면 다음 영업일입니다 | 결제 수단 `BillingMandate`와 `Payment`입니다 ([billing.md](billing.md#용어), [payment-schedule](../reference/rules/payment-schedule.md)) | |

## 전자서명과 제증명

| 용어 | 뜻 | 이 저장소에서 | 근거 |
|---|---|---|---|
| 전자서명 | 근로계약서·사직서 같은 문서를 종이 없이 서명하는 것입니다. 서명자가 본인임을 확인한 뒤 서명합니다 | `EsignRequest`, 링크 토큰과 이름 + 생년월일 본인확인(5회 실패 잠금)입니다 ([documents.md](documents.md#전자서명-요청), [esign-identity-verification](../reference/rules/esign-identity-verification.md)) | 전자서명법, 전자문서 및 전자거래 기본법 (확인 필요, [compliance.md](compliance.md#전자서명)) |
| 제증명 | 회사가 직원에게 발급하는 재직·경력·퇴직증명서입니다 | `CertificateIssuance`입니다. 발급번호는 회사·연도별 `YYYY-NNNN`이고 무효화해도 다시 쓰지 않습니다 ([documents.md](documents.md#제증명-발급), [certificate-issuance](../reference/rules/certificate-issuance.md)) | |
