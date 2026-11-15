# 신고 건 제출 자료

## 요약

- 신고 건을 만들 때 세목별 제출 자료 체크리스트를 복사합니다. 부가세 6개, 원천세 6개(급여 플랜 회사는 맨 앞에 급여대장 마감 항목 추가), 예정고지·법인세·종합소득세는 없음
- 고객은 항목마다 `not_applicable`/`pending`을 고르거나 파일을 붙입니다. 파일이 붙으면 `provided`, 마지막 파일을 떼면 `pending`입니다
- 원천세 `payroll_ledger_closed`는 자동 연계 항목입니다. 신고 기간에 지급한 급여대장이 1개 이상이고 모두 마감이면 `provided`, 아니면 `pending`이며 고객이 고칠 수 없습니다

## 현행 위치

- 템플릿: `apps/api/legacy/src/modules/filings/requirement-templates.ts` (`requirementsFor`)
- 응답·파일: `apps/api/legacy/src/modules/filings/filings.service.ts` (`setRequirementResponse`, `detachRequirementFile`, 파일 첨부 경로)
- 급여대장 연계: `apps/api/legacy/src/modules/payroll/withholding/withholding-link.ts` (`payrollLedgerResponse`, `syncPayrollLedgerRequirement`)
- 매뉴얼: `manual/06-세무/01-부가세.md`, `manual/06-세무/02-원천세.md`
- 급여 쪽 명세: `docs/reference/spec/payroll.md`

## 로직

| 세목 | 항목 |
|---|---|
| 부가세 | `pg_online_sales`, `export_fx`, `paper_tax_invoice`, `simple_receipt`, `ending_inventory`, `deposit_fund_accounts` |
| 원천세 | (급여 플랜이면) `payroll_ledger_closed`, `business_income`, `other_income`, `daily_wage`, `retirement_income`, `interest_dividend`, `unreflected_bonus` |

- 응답
  - 자동 연계 항목 → 거절
  - 파일이 붙은 항목에 `not_applicable` → 거절
  - 파일이 붙은 항목에 `pending` → `provided`로 남음
  - 그 밖에는 고른 값
- 파일: 붙이면 `provided`, 떼고 남은 파일이 0이면 `pending`
- 응답·파일 변경은 신고 건이 `requested`일 때만 받고, `If-Match`를 받지 않습니다
- 제출 검사(`submit`)는 자동 연계 항목을 빼고 `pending`이 남았는지 봅니다

## 근거

`apps/api/legacy/src/modules/payroll/withholding/withholding-link.ts`

```ts
export function payrollLedgerResponse(db: DatabaseSync, companyId: string, periodStart: PlainDate, periodEnd: PlainDate): RequirementResponse {
  const cards = listCardsPaidBetween(db, companyId, periodStart, periodEnd)
  return cards.length > 0 && cards.every((card) => isClosed(card.status)) ? 'provided' : 'pending'
}
```

매뉴얼 원천세 화면은 "급여대장 마감 여부"를 고객이 고칠 수 없는 항목으로 보여 주고, 나머지는 "해당 없음" 또는 파일 첨부로 답하게 합니다.

## 서버 이전 시 주의

- 법인세·종합소득세는 체크리스트가 없어 고객 자료 제출 흐름이 비어 있습니다
- 항목 라벨(한글 문구)을 서버가 내려줍니다
- 파일이 있는 항목에 `pending`을 골라도 바뀌지 않아 고객에게는 무시된 것처럼 보입니다
- 지급한 급여대장이 하나도 없으면 `pending`이라, 급여가 없는 달의 원천세는 대리인이 직접 처리해야 합니다
- 자동 연계 항목이 `pending`이어도 고객은 제출할 수 있습니다

## 픽스처

[`apps/api/test/fixtures/rules/filing-requirements.json`](../../../apps/api/test/fixtures/rules/filing-requirements.json): 18건 (모두 traced)

| 케이스 | 입력 요지 | 결과 |
|---|---|---|
| 템플릿 7건 | 부가세, 예정고지, 원천세(급여 플랜 유무), 반기 원천세, 법인세, 종합소득세 | 항목 목록 |
| 응답 5건 | 빈 항목·파일 있는 항목에 `not_applicable`/`pending`, 자동 연계 항목 | 응답 또는 거절 |
| 파일 3건 | 첫 파일, 둘 중 하나 떼기, 마지막 떼기 | `provided`/`provided`/`pending` |
| 급여대장 3건 | 모두 마감, 하나 미마감, 대장 없음 | `provided`/`pending`/`pending` |
