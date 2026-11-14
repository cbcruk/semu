import { Result } from 'effect'
import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { decideWorkContractCreation, decideWorkContractSigning } from './work-contract.aggregate.ts'
import type { WorkContractRecord } from './work-contract.ts'

const COMPANY = 'cmp_01JBQ000000000000000000001' as Id<'company'>
const EMPLOYEE = 'emp_01JBQ000000000000000000001' as Id<'employee'>
const CONTRACT = 'wct_01JBQ000000000000000000001' as Id<'workContract'>
const SIGNED = 'doc_01JBQ000000000000000000001' as Id<'document'>
const RESIGNED = 'doc_01JBQ000000000000000000002' as Id<'document'>
const AT = '2026-11-14T01:00:00.000Z'

function created(): WorkContractRecord {
  const result = decideWorkContractCreation(
    {
      id: CONTRACT,
      companyId: COMPANY,
      employeeId: EMPLOYEE,
      terms: { contractType: 'PERMANENT', startDate: '2026-01-02' },
    },
    AT,
  )
  if (Result.isFailure(result)) throw result.failure
  return result.success.workContract
}

describe('근로계약 생성 판정', () => {
  it('입력을 그대로 담고 만든 시각을 남깁니다', () => {
    expect(created()).toEqual({
      id: CONTRACT,
      companyId: COMPANY,
      employeeId: EMPLOYEE,
      contractType: 'PERMANENT',
      startDate: '2026-01-02',
      createdAt: AT,
    })
  })

  it('기간제인데 종료일이 없으면 거부합니다', () => {
    const result = decideWorkContractCreation(
      {
        id: CONTRACT,
        companyId: COMPANY,
        employeeId: EMPLOYEE,
        terms: { contractType: 'FIXED_TERM', startDate: '2026-01-02' },
      },
      AT,
    )
    expect(Result.isFailure(result) && result.failure).toMatchObject({
      _tag: 'WorkContractInvalid',
      violations: [{ field: 'endDate', code: 'END_DATE_REQUIRED' }],
    })
  })
})

describe('근로계약 서명 연결 판정', () => {
  it('서명 문서를 잇고, 무효로 풀 때는 지금 그 문서를 가리킬 때만 풉니다', () => {
    const signed = decideWorkContractSigning(created(), SIGNED)?.workContract
    expect(signed?.signedDocumentId).toBe(SIGNED)
    expect(decideWorkContractSigning(signed!, undefined, RESIGNED)).toBeUndefined()
    expect(decideWorkContractSigning(signed!, undefined, SIGNED)?.workContract.signedDocumentId).toBeUndefined()
  })
})
