import { Result } from 'effect'
import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import {
  decideFamilyMemberCreation,
  decideFamilyMemberRemoval,
  decideFamilyMemberUpdate,
  planFamilyMember,
  planFamilyMemberCreation,
  type DependantFiling,
} from './family-member.aggregate.ts'
import type { FamilyMemberInput } from './family-member.ts'

const OWNER = {
  id: 'fam_01JBQ000000000000000000001' as Id<'familyMember'>,
  companyId: 'cmp_01JBQ000000000000000000001' as Id<'company'>,
  employeeId: 'emp_01JBQ000000000000000000001' as Id<'employee'>,
}
const AS_OF = '2026-06-01'
const SPOUSE: FamilyMemberInput = { name: '김배우', birthDate: '1990-01-01', relation: 'SPOUSE' }
const DEPENDANT: FamilyMemberInput = { ...SPOUSE, registrationNumber: '900101-2234567', healthInsuranceDependant: true }

function plan(input: FamilyMemberInput) {
  const result = planFamilyMember(input, AS_OF)
  if (Result.isFailure(result)) throw result.failure
  return result.success
}

function filing(change: 'ADD' | 'REMOVE', status: DependantFiling['status'], processedAt?: string): DependantFiling {
  return {
    id: 'isf_01JBQ000000000000000000001' as Id<'insuranceFiling'>,
    companyId: OWNER.companyId,
    employeeId: OWNER.employeeId,
    kind: 'DEPENDANT',
    source: { type: 'FAMILY_MEMBER', id: OWNER.id },
    payload: { familyMemberId: OWNER.id, change, name: SPOUSE.name, relation: 'SPOUSE', birthDate: SPOUSE.birthDate },
    status,
    requestedAt: '2026-05-01T00:00:00.000Z',
    ...(processedAt === undefined ? {} : { processedAt }),
  }
}

describe('가족 입력 검사', () => {
  it('근로소득자가 아니면 입력보다 먼저 거부합니다', () => {
    const result = planFamilyMemberCreation({ ...SPOUSE, healthInsuranceDependant: true }, AS_OF, 'BUSINESS')
    expect(Result.isFailure(result) && result.failure._tag).toBe('EmployeeKindNotSupported')
  })

  it('피부양자인데 번호가 없으면 거부하고, 빠진 값은 기본값으로 채웁니다', () => {
    const missing = planFamilyMember({ ...SPOUSE, healthInsuranceDependant: true }, AS_OF)
    expect(Result.isFailure(missing) && missing.failure).toMatchObject({
      violations: [{ field: 'registrationNumber', code: 'REQUIRED' }],
    })
    expect(plan(SPOUSE).fields).toMatchObject({ isForeigner: false, yearEndDependantType: 'NOT_ELIGIBLE' })
  })
})

describe('가족 등록·수정 판정', () => {
  it('봉인한 번호와 가린 번호를 담고 피부양자면 취득 신고를 엽니다', () => {
    const { member, filings } = decideFamilyMemberCreation(OWNER, plan(DEPENDANT), 'enc-1', [])
    expect(member).toMatchObject({ registrationNumberEncrypted: 'enc-1', version: 1 })
    expect(member.registrationNumberMasked).not.toContain('2234567')
    expect(filings).toEqual([
      { action: 'WITHDRAW' },
      { action: 'OPEN', payload: expect.objectContaining({ familyMemberId: OWNER.id, change: 'ADD' }) },
    ])
  })

  it('내용이 같은 열린 취득 신고가 있으면 아무것도 하지 않습니다', () => {
    const { member } = decideFamilyMemberCreation(OWNER, plan(DEPENDANT), 'enc-1', [])
    expect(decideFamilyMemberUpdate(member, plan(DEPENDANT), 'enc-2', [filing('ADD', 'PENDING')]).filings).toEqual([])
  })

  it('번호를 빼고 피부양자를 풀면 번호를 지우고 열린 취득 신고만 거둡니다', () => {
    const { member } = decideFamilyMemberCreation(OWNER, plan(DEPENDANT), 'enc-1', [])
    const next = decideFamilyMemberUpdate(member, plan(SPOUSE), undefined, [filing('ADD', 'PENDING')])
    expect(next.member).toMatchObject({ registrationNumberEncrypted: undefined, version: 2 })
    expect(next.filings).toEqual([{ action: 'WITHDRAW' }])
  })
})

describe('가족 삭제 판정', () => {
  it('공단에 등록된 피부양자는 지우지 않습니다', () => {
    const { member } = decideFamilyMemberCreation(OWNER, plan(DEPENDANT), 'enc-1', [])
    const result = decideFamilyMemberRemoval(member, [filing('ADD', 'DONE', '2026-05-02T00:00:00.000Z')])
    expect(Result.isFailure(result) && result.failure._tag).toBe('FamilyMemberDependantRegistered')
  })
})
