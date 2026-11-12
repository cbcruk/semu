import type { Violation } from '../../../shared/problem/problem.types.ts'
import type { DependantChange, InsuranceFilingStatus } from '../insurance-filings/insurance-filing.types.ts'
import { birthDateFromRegistrationNumber, normalizeIdentityNumber } from '../shared/identity-number.ts'
import { canBeTaxFreeTarget } from './dependant-rules.ts'
import type { FamilyRelation, YearEndDependantType } from './family-member.types.ts'

/** 검사할 가족 입력입니다. */
export interface FamilyMemberTerms {
  relation: FamilyRelation
  birthDate: string
  registrationNumber?: string | undefined
  taxFreeTarget: boolean
  yearEndTarget: boolean
  yearEndDependantType: YearEndDependantType
}

/** 검사 결과입니다. 주민번호가 있고 형식이 맞으면 하이픈을 뺀 값이 `registrationNumber`에 있습니다. */
export interface FamilyMemberValidation {
  violations: Violation[]
  registrationNumber?: string
}

/**
 * 가족 입력을 검사합니다. 위반은 모두 모읍니다.
 *
 * - 비과세(보육수당) 대상은 `asOf`가 속한 과세기간 개시일 현재 6세 이하 자녀만 됩니다(`taxFreeTarget` `NOT_ELIGIBLE`)
 * - 연말정산 대상이면 공제 구분이 있어야 하고(`REQUIRED`), 대상이 아니면 `NOT_ELIGIBLE`이어야 합니다(`NOT_APPLICABLE`)
 * - 주민번호(외국인등록번호)는 형식이 맞아야 하고(`INVALID_FORMAT`), 담긴 생년월일이 `birthDate`와 같아야 합니다
 *   (`BIRTH_DATE_MISMATCH`)
 *
 * @example
 * ```ts
 * validateFamilyMember({ relation: 'SPOUSE', birthDate: '1990-01-01', taxFreeTarget: true, yearEndTarget: false,
 *   yearEndDependantType: 'NOT_ELIGIBLE' }, '2026-06-01').violations // [{ field: 'taxFreeTarget', code: 'NOT_ELIGIBLE' }]
 * ```
 */
export function validateFamilyMember(terms: FamilyMemberTerms, asOf: string): FamilyMemberValidation {
  const violations: Violation[] = []
  if (terms.taxFreeTarget && !canBeTaxFreeTarget(terms, asOf)) {
    violations.push({ field: 'taxFreeTarget', code: 'NOT_ELIGIBLE' })
  }
  if (terms.yearEndTarget && terms.yearEndDependantType === 'NOT_ELIGIBLE') {
    violations.push({ field: 'yearEndDependantType', code: 'REQUIRED' })
  }
  if (!terms.yearEndTarget && terms.yearEndDependantType !== 'NOT_ELIGIBLE') {
    violations.push({ field: 'yearEndDependantType', code: 'NOT_APPLICABLE' })
  }
  if (terms.registrationNumber === undefined) return { violations }
  const 정규화번호 = normalizeIdentityNumber(terms.registrationNumber, 'RRN')
  if (정규화번호 === null) {
    violations.push({ field: 'registrationNumber', code: 'INVALID_FORMAT' })
    return { violations }
  }
  if (birthDateFromRegistrationNumber(정규화번호) !== terms.birthDate) {
    violations.push({ field: 'registrationNumber', code: 'BIRTH_DATE_MISMATCH' })
  }
  return { violations, registrationNumber: 정규화번호 }
}

/**
 * 피부양자 상태를 맞추려면 열어야 할 신고입니다. 맞춰져 있으면 `undefined`입니다.
 *
 * 공단에 등록된 상태는 가장 나중에 완료(`DONE`)한 신고로 봅니다. 완료한 신고가 없으면 등록되지 않은 상태입니다.
 * 열린 신고(`PENDING`·`FAILED`)는 아직 공단에 반영되지 않았으므로 상태에 넣지 않습니다.
 *
 * @example
 * ```ts
 * dependantChange(true, []) // 'ADD'
 * dependantChange(false, [{ status: 'DONE', processedAt: '…', payload: { change: 'ADD' } }]) // 'REMOVE'
 * ```
 */
export function dependantChange(
  wanted: boolean,
  filings: ReadonlyArray<{
    status: InsuranceFilingStatus
    processedAt?: string | undefined
    payload: { change: DependantChange }
  }>,
): DependantChange | undefined {
  const 완료신고 = filings
    .filter((filing) => filing.status === 'DONE')
    .toSorted((a, b) => (a.processedAt ?? '').localeCompare(b.processedAt ?? ''))
  const 등록됨 = 완료신고.at(-1)?.payload.change === 'ADD'
  if (wanted === 등록됨) return undefined
  return wanted ? 'ADD' : 'REMOVE'
}
