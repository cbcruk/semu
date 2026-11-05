# 전자서명 발송 검증

## 요약

- 발송 전 수신자 이메일, 외국인 국적·체류자격, 문서 1개 이상, 템플릿 사용 중, 필수 필드, 회사 도장을 확인합니다
- 필수 필드는 관리자 값 → 템플릿 기본값 → 직원 정보 순으로 채워져 있어야 하고, 숨긴 필드와 서명자 필드는 건너뜁니다

## 현행 위치

- `apps/api/legacy/src/modules/hr/e-sign/e-sign-requests.service.ts:348-385`
- `alfred-manual/04-인사/03-전자서명.md:76`
- `docs/reference/spec/hr.md:656`
- `e-sign-requests.service.ts`의 `validateForSend`, `assertRequiredFields`, `sourceValue`
- 매뉴얼 전자서명(외국인)
- 스펙 R22

## 로직

- 도장은 요청에 고른 것, 없으면 문서 순서대로 첫 템플릿 기본 도장
- 첫 위반에서 422로 멈춥니다

## 근거

`apps/api/legacy/src/modules/hr/e-sign/e-sign-requests.service.ts:348-385`

```ts
function validateForSend(db: DatabaseSync, aggregate: ESignRequestAggregate): number {
  const { request, recipient, documents } = aggregate
  if (recipient.email === null) throw invalidField('recipient.email', 'An email address is required to send the request.')
  if (recipient.is_local === 0) {
    if (recipient.nationality === null) throw invalidField('recipient.nationality', 'Foreign recipients need a nationality.')
    if (recipient.visa === null) throw invalidField('recipient.visa', 'Foreign recipients need a residence status.')
  }
  if (documents.length === 0) throw invalidField('templates', 'Choose at least one template.')
  const fieldValues = JSON.parse(request.field_values) as FieldValueMap
  const employee = recipient.employee_id === null ? undefined : findEmployeeRow(db, request.company_id, recipient.employee_id)
  let defaultSeal: number | null = null
  for (const document of documents) {
    const template = findTemplate(db, request.company_id, document.template_id)
    if (template === undefined || !template.is_active) throw invalidField(`templates.${document.doc_index}`, 'This template is turned off.')
    defaultSeal ??= template.default_seal_id
    assertRequiredFields(template, fieldValues[String(document.doc_index)] ?? {}, employee, document.doc_index)
  }
  const sealId = request.company_seal_id ?? defaultSeal
  if (sealId === null) throw invalidField('company_seal', 'Choose the company seal to stamp.')
  requireActiveSeal(db, request.company_id, sealId, 'company_seal')
  return sealId
}

function assertRequiredFields(template: ResolvedTemplate, values: Record<string, unknown>, employee: EmployeeRow | undefined, index: number): void {
  const hidden = Array.isArray(values['__hidden']) ? (values['__hidden'] as unknown[]) : []
  for (const field of template.fields) {
    if (!field.required || field.signer || hidden.includes(field.key)) continue
    const value = values[field.key] ?? field.default ?? sourceValue(field.source, employee)
    if (value === null || value === undefined || value === '') throw invalidField(`field_values.${index}.${field.key}`, `${field.label} is required.`)
  }
}

function sourceValue(source: string | null, employee: EmployeeRow | undefined): unknown {
  if (source === null || employee === undefined || !source.startsWith('employee.')) return null
  return (employee as unknown as Record<string, unknown>)[source.slice('employee.'.length)] ?? null
}

```

## 서버 이전 시 주의

- 숨긴 필드 목록은 현행 `field_values.__hidden`에서 `hiddenFields`로 분리합니다
- 직원 원천 값은 `HrDirectory`로 읽습니다

## 열린 질문

1. 현행은 첫 위반에서 멈춥니다. 재설계는 위반을 모두 돌려줘도 될까요
2. 도장을 고르지 않으면 첫 템플릿부터 처음 나오는 기본 도장을 씁니다. 문서마다 다른 기본 도장이 있으면 문서별로 찍을까요
3. 수신자가 직원이 아니면 `employee.*` 원천 값이 없어 필수 필드가 비어 거절됩니다. 맞습니까

## 픽스처

[`apps/api/test/fixtures/rules/esign-send-validation.json`](../../../apps/api/test/fixtures/rules/esign-send-validation.json): 11건 (모두 추적)

| 케이스 | 결과 |
|---|---|
| ready to send with template seal | `{"firstViolation": null, "companySealId": "fle_seal"}` |
| chosen seal wins | `{"firstViolation": null, "companySealId": "fle_other"}` |
| missing email | `{"firstViolation": "recipient.email", "companySealId": null}` |
| foreigner without visa | `{"firstViolation": "recipient.visaCode", "companySealId": null}` |
| no documents | `{"firstViolation": "documents", "companySealId": null}` |
| inactive template | `{"firstViolation": "documents[0]", "companySealId": null}` |
| required field empty | `{"firstViolation": "fieldValues.0.position", "companySealId": null}` |
| hidden required field skipped | `{"firstViolation": null, "companySealId": "fle_seal"}` |
| signer field skipped | `{"firstViolation": null, "companySealId": "fle_seal"}` |
| employee source fills field | `{"firstViolation": null, "companySealId": "fle_seal"}` |
| no seal anywhere | `{"firstViolation": "companySealId", "companySealId": null}` |
