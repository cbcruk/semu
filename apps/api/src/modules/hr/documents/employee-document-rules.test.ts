import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { documentCategoryOf, signedContractLinks } from './employee-document-rules.ts'
import type { LinkCandidates } from './employee-document.types.ts'

const wct = (n: number) => `wct_${n}` as Id<'workContract'>
const pct = (n: number) => `pct_${n}` as Id<'payrollContract'>

const candidates: LinkCandidates = {
  joinDate: '2026-03-02',
  workContracts: [
    { id: wct(1), startDate: '2026-03-02', createdAt: '2026-02-20T09:00:00Z' },
    { id: wct(2), startDate: '2027-03-02', createdAt: '2027-02-20T09:00:00Z' },
  ],
  payrollContracts: [
    { id: pct(1), startDate: '2026-03-02', annualSalary: 36_000_000, createdAt: '2026-02-20T09:00:00Z' },
    { id: pct(2), startDate: '2027-01-01', annualSalary: 42_000_000, createdAt: '2026-12-20T09:00:00Z' },
    { id: pct(3), startDate: '2027-01-01', createdAt: '2026-12-21T09:00:00Z' },
  ],
}

describe('보관함 카테고리(documentCategoryOf)', () => {
  it('계약서가 하나라도 있으면 계약입니다', () => {
    expect(documentCategoryOf(['EMPLOYMENT_CONTRACT'])).toBe('CONTRACT')
    expect(documentCategoryOf(['EMPLOYMENT_CERTIFICATE', 'SALARY_CONTRACT'])).toBe('CONTRACT')
  })

  it('모두 증명서면 증명서입니다', () => {
    expect(documentCategoryOf(['EMPLOYMENT_CERTIFICATE', 'CAREER_CERTIFICATE'])).toBe('CERTIFICATE')
  })

  it('모르는 종류만 있거나 비어 있으면 기타입니다', () => {
    expect(documentCategoryOf([])).toBe('OTHER')
    expect(documentCategoryOf(['NDA'])).toBe('OTHER')
  })
})

describe('서명 문서가 확정하는 계약(signedContractLinks)', () => {
  it('근로계약서는 근로개시일에 시작하는 근로계약을 잇습니다', () => {
    const links = signedContractLinks(
      [{ kind: 'EMPLOYMENT_CONTRACT', title: '근로계약서', terms: { startDate: '2027-03-02' } }],
      candidates,
    )
    expect(links).toEqual([{ type: 'WORK_CONTRACT', id: wct(2) }])
  })

  it('근로개시일을 비워 둔 근로계약서는 입사일로 맞춥니다', () => {
    const links = signedContractLinks([{ kind: 'EMPLOYMENT_CONTRACT', title: '근로계약서', terms: {} }], candidates)
    expect(links).toEqual([{ type: 'WORK_CONTRACT', id: wct(1) }])
  })

  it('맞는 계약이 없으면 잇지 않습니다', () => {
    const links = signedContractLinks(
      [{ kind: 'EMPLOYMENT_CONTRACT', title: '근로계약서', terms: { startDate: '2026-04-01' } }],
      candidates,
    )
    expect(links).toEqual([])
  })

  it('연봉계약서는 적용 시작일과 연봉이 같은 급여계약을 잇습니다', () => {
    const links = signedContractLinks(
      [
        {
          kind: 'SALARY_CONTRACT',
          title: '연봉계약서',
          terms: { effectiveDate: '2027-01-01', annualSalary: 42_000_000 },
        },
      ],
      candidates,
    )
    expect(links).toEqual([{ type: 'PAYROLL_CONTRACT', id: pct(2) }])
  })

  it('연봉이 다르면 잇지 않습니다', () => {
    const links = signedContractLinks(
      [
        {
          kind: 'SALARY_CONTRACT',
          title: '연봉계약서',
          terms: { effectiveDate: '2026-03-02', annualSalary: 40_000_000 },
        },
      ],
      candidates,
    )
    expect(links).toEqual([])
  })

  it('연봉이 없으면 적용 시작일만 보고, 여럿이면 가장 나중에 만든 계약을 잇습니다', () => {
    const links = signedContractLinks(
      [{ kind: 'SALARY_CONTRACT', title: '연봉계약서', terms: { effectiveDate: '2027-01-01' } }],
      candidates,
    )
    expect(links).toEqual([{ type: 'PAYROLL_CONTRACT', id: pct(3) }])
  })

  it('적용 시작일이 없는 연봉계약서는 잇지 않습니다', () => {
    const links = signedContractLinks(
      [{ kind: 'SALARY_CONTRACT', title: '연봉계약서', terms: { annualSalary: 36_000_000 } }],
      candidates,
    )
    expect(links).toEqual([])
  })

  it('한 요청의 근로·연봉계약서를 함께 잇고, 같은 계약은 한 번만 넣습니다', () => {
    const links = signedContractLinks(
      [
        { kind: 'EMPLOYMENT_CONTRACT', title: '근로계약서', terms: {} },
        { kind: 'SALARY_CONTRACT', title: '연봉계약서', terms: { effectiveDate: '2026-03-02' } },
        { kind: 'EMPLOYMENT_CONTRACT', title: '근로계약서 사본', terms: { startDate: '2026-03-02' } },
      ],
      candidates,
    )
    expect(links).toEqual([
      { type: 'WORK_CONTRACT', id: wct(1) },
      { type: 'PAYROLL_CONTRACT', id: pct(1) },
    ])
  })

  it('증명서는 계약을 잇지 않습니다', () => {
    expect(
      signedContractLinks([{ kind: 'EMPLOYMENT_CERTIFICATE', title: '재직증명서', terms: {} }], candidates),
    ).toEqual([])
  })
})
