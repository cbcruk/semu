import { isCalendarDate } from '../../../shared/time/date-format.ts'
import type { DocumentKind, SignedTerms } from './signed-terms.types.ts'

/**
 * 서명 완료 문서에서 인사 기록에 이어 붙일 계약 조건을 뽑습니다. 문서 종류마다 정해진 필드만 보고, 형식이 틀린 값은 버립니다.
 *
 * - 근로계약서: 근로개시일(`startDate`)
 * - 연봉계약서: 적용 시작일(`effectiveDate`)과 연봉(`annualSalary`, 0 이상 정수 원)
 * - 증명서: 없음
 *
 * 관리자가 비워 두고 직원 기록으로 채운 필드(`source: employee.joinDate`)는 값이 없으므로 여기서도 없습니다. 채우는 일은 HR이 합니다.
 *
 * @example
 * ```ts
 * signedTermsOf('SALARY_CONTRACT', { annualSalary: 42_000_000, effectiveDate: '2026-03-01' })
 * // { effectiveDate: '2026-03-01', annualSalary: 42000000 }
 * signedTermsOf('EMPLOYMENT_CONTRACT', { startDate: '2026-13-01' }) // {}
 * ```
 */
export function signedTermsOf(kind: DocumentKind, values: Readonly<Record<string, unknown>>): SignedTerms {
  if (kind === 'EMPLOYMENT_CONTRACT') {
    const 근로개시일 = dateOf(values['startDate'])
    return 근로개시일 === undefined ? {} : { startDate: 근로개시일 }
  }
  if (kind === 'SALARY_CONTRACT') {
    const 적용시작일 = dateOf(values['effectiveDate'])
    const 연봉 = values['annualSalary']
    return {
      ...(적용시작일 === undefined ? {} : { effectiveDate: 적용시작일 }),
      ...(Number.isSafeInteger(연봉) && (연봉 as number) >= 0 ? { annualSalary: 연봉 as number } : {}),
    }
  }
  return {}
}

function dateOf(value: unknown): string | undefined {
  return typeof value === 'string' && isCalendarDate(value) ? value : undefined
}
