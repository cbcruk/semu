import type { Violation } from '../../../shared/problem/problem.types.ts'
import type { SendCheckInput } from './esign-send-validation.types.ts'

/**
 * 전자서명 요청을 보낼 수 있는지 검사하고, 찍을 회사 도장을 정합니다(현행 R22).
 *
 * - 수신자 이메일 필수
 * - 외국인이면 국적·체류자격 필수
 * - 문서가 하나 이상이고 모든 템플릿이 켜져 있어야 함
 * - 숨기지 않았고 서명자가 채우지 않는 필수 필드는 관리자 값 → 템플릿 기본값 → 직원 값 순으로 채워져 있어야 함
 * - 도장은 요청에 고른 것, 없으면 첫 템플릿부터 처음 나오는 기본 도장
 *
 * 현행은 첫 위반에서 멈췄고, 재설계는 모든 위반을 돌려줍니다.
 */
export function validateEsignSend(input: SendCheckInput): { violations: Violation[]; companySealId?: string } {
  const violations: Violation[] = []
  const { recipient } = input
  if (isBlank(recipient.email)) violations.push({ field: 'recipient.email', code: 'REQUIRED' })
  if (recipient.isForeigner) {
    if (isBlank(recipient.nationalityCode)) violations.push({ field: 'recipient.nationalityCode', code: 'REQUIRED' })
    if (isBlank(recipient.visaCode)) violations.push({ field: 'recipient.visaCode', code: 'REQUIRED' })
  }
  if (input.documents.length === 0) violations.push({ field: 'documents', code: 'REQUIRED' })
  let defaultSeal: string | undefined
  for (const document of input.documents) {
    const key = String(document.index)
    if (!document.templateActive) violations.push({ field: `documents[${document.index}]`, code: 'TEMPLATE_INACTIVE' })
    defaultSeal ??= document.defaultCompanySealId
    const values = input.fieldValues[key] ?? {}
    const hidden = input.hiddenFields[key] ?? []
    for (const field of document.fields) {
      if (!field.required || field.signer || hidden.includes(field.key)) continue
      const value =
        values[field.key] ??
        field.default ??
        (field.source === undefined ? undefined : input.sourceValues[field.source])
      if (value === undefined || value === null || value === '') {
        violations.push({ field: `fieldValues.${key}.${field.key}`, code: 'REQUIRED' })
      }
    }
  }
  const companySealId = input.companySealId ?? defaultSeal
  if (companySealId === undefined) violations.push({ field: 'companySealId', code: 'REQUIRED' })
  return companySealId === undefined ? { violations } : { violations, companySealId }
}

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === ''
}
