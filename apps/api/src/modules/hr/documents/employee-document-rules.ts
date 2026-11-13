import type {
  EmployeeDocumentCategory,
  EmployeeDocumentLink,
  LinkCandidates,
  SignedDocumentPart,
} from './employee-document.types.ts'

const 계약서 = new Set(['EMPLOYMENT_CONTRACT', 'SALARY_CONTRACT'])
const 증명서 = new Set(['EMPLOYMENT_CERTIFICATE', 'CAREER_CERTIFICATE', 'RETIREMENT_CERTIFICATE'])

/**
 * 서명 완료 요청을 넣을 보관함 카테고리입니다. 계약서가 하나라도 있으면 `CONTRACT`, 모두 증명서면 `CERTIFICATE`, 아니면 `OTHER`입니다.
 *
 * @example
 * ```ts
 * documentCategoryOf(['EMPLOYMENT_CONTRACT', 'SALARY_CONTRACT']) // 'CONTRACT'
 * documentCategoryOf([]) // 'OTHER'
 * ```
 */
export function documentCategoryOf(kinds: ReadonlyArray<string>): EmployeeDocumentCategory {
  if (kinds.some((kind) => 계약서.has(kind))) return 'CONTRACT'
  if (kinds.length > 0 && kinds.every((kind) => 증명서.has(kind))) return 'CERTIFICATE'
  return 'OTHER'
}

/**
 * 서명 완료 문서가 확정하는 계약입니다. 조건이 맞는 계약이 여럿이면 가장 나중에 만든 것 하나만 잇고, 없으면 잇지 않습니다.
 *
 * - 근로계약서: 근로개시일(비워 두었으면 입사일)에 시작하는 근로계약
 * - 연봉계약서: 적용 시작일에 시작하는 급여계약. 연봉이 적혀 있으면 계약의 연봉도 같아야 합니다. 적용 시작일이 없으면 잇지 않습니다
 *
 * @example
 * ```ts
 * signedContractLinks([{ kind: 'EMPLOYMENT_CONTRACT', title: '근로계약서', terms: {} }], {
 *   joinDate: '2026-03-02',
 *   workContracts: [{ id: 'wct_1', startDate: '2026-03-02', createdAt: '2026-02-20T09:00:00Z' }],
 *   payrollContracts: [],
 * }) // [{ type: 'WORK_CONTRACT', id: 'wct_1' }]
 * ```
 */
export function signedContractLinks(
  documents: ReadonlyArray<SignedDocumentPart>,
  candidates: LinkCandidates,
): EmployeeDocumentLink[] {
  const links: EmployeeDocumentLink[] = []
  const add = (link: EmployeeDocumentLink | undefined) => {
    if (link !== undefined && !links.some((known) => known.type === link.type && known.id === link.id)) links.push(link)
  }
  for (const document of documents) {
    if (document.kind === 'EMPLOYMENT_CONTRACT') {
      const 근로개시일 = document.terms.startDate ?? candidates.joinDate
      const 계약 = 가장최근(candidates.workContracts.filter((contract) => contract.startDate === 근로개시일))
      add(계약 === undefined ? undefined : { type: 'WORK_CONTRACT', id: 계약.id })
    } else if (document.kind === 'SALARY_CONTRACT') {
      const { effectiveDate: 적용시작일, annualSalary: 연봉 } = document.terms
      if (적용시작일 === undefined) continue
      const 계약 = 가장최근(
        candidates.payrollContracts.filter(
          (contract) => contract.startDate === 적용시작일 && (연봉 === undefined || contract.annualSalary === 연봉),
        ),
      )
      add(계약 === undefined ? undefined : { type: 'PAYROLL_CONTRACT', id: 계약.id })
    }
  }
  return links
}

function 가장최근<T extends { createdAt: string }>(contracts: ReadonlyArray<T>): T | undefined {
  return contracts.reduce<T | undefined>(
    (latest, contract) => (latest === undefined || contract.createdAt > latest.createdAt ? contract : latest),
    undefined,
  )
}
