import { Result } from 'effect'
import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { WorkContractRecord } from '../contracts/work-contract.ts'
import {
  decideDocumentRemoval,
  decideDocumentUpload,
  decideSignedDocumentIntake,
  decideSignedDocumentVoid,
  type CompletedEsignRequest,
  type SignedDocumentFacts,
} from './employee-document.aggregate.ts'

const COMPANY = 'cmp_01JBQ000000000000000000001' as Id<'company'>
const EMPLOYEE = 'emp_01JBQ000000000000000000001' as Id<'employee'>
const DOCUMENT = 'doc_01JBQ000000000000000000001' as Id<'document'>
const OTHER_DOCUMENT = 'doc_01JBQ000000000000000000002' as Id<'document'>
const AT = '2026-11-14T01:00:00.000Z'
const LATER = '2026-11-15T01:00:00.000Z'
const WORK: WorkContractRecord = {
  id: 'wct_01JBQ000000000000000000001' as Id<'workContract'>,
  companyId: COMPANY,
  employeeId: EMPLOYEE,
  contractType: 'PERMANENT',
  startDate: '2026-03-02',
  createdAt: '2026-02-20T00:00:00.000Z',
}
const REQUEST: CompletedEsignRequest = {
  companyId: COMPANY,
  esignRequestId: 'esr_01JBQ000000000000000000001' as Id<'esignRequest'>,
  employeeId: EMPLOYEE,
  title: '근로계약서',
  fileId: 'fil_01JBQ000000000000000000001' as Id<'file'>,
  signedAt: AT,
  documents: [{ kind: 'EMPLOYMENT_CONTRACT', title: '근로계약서', terms: {} }],
}
const FACTS: SignedDocumentFacts = {
  alreadyFiled: false,
  employee: { joinDate: '2026-03-02' },
  workContracts: [WORK],
  payrollContracts: [],
}

describe('직원 문서 업로드·삭제 판정', () => {
  it('저장한 파일로 직접 올린 문서를 만들고, 직접 올린 문서만 지웁니다', () => {
    const { document } = decideDocumentUpload(
      {
        id: DOCUMENT,
        companyId: COMPANY,
        employeeId: EMPLOYEE,
        category: 'OTHER',
        title: '통장 사본',
        createdBy: 'usr_01JBQ000000000000000000001' as Id<'user'>,
      },
      { id: 'fil_1' as Id<'file'>, name: 'bank.pdf', contentType: 'application/pdf' },
      AT,
    )
    expect(document).toMatchObject({ origin: 'UPLOAD', status: 'ACTIVE', fileName: 'bank.pdf', links: [] })
    expect(Result.isSuccess(decideDocumentRemoval(document))).toBe(true)
    const locked = decideDocumentRemoval({ ...document, origin: 'ESIGN' })
    expect(Result.isFailure(locked) && locked.failure).toMatchObject({ _tag: 'DocumentLocked', origin: 'ESIGN' })
  })
})

describe('서명 문서 반영 판정', () => {
  it('완료본을 넣고 근로개시일이 같은 근로계약에 서명 문서를 잇습니다', () => {
    const decision = decideSignedDocumentIntake(REQUEST, DOCUMENT, FACTS, AT)
    expect(decision?.document).toMatchObject({
      origin: 'ESIGN',
      status: 'ACTIVE',
      fileName: '근로계약서.pdf',
      links: [{ type: 'WORK_CONTRACT', id: WORK.id }],
    })
    expect(decision?.workContracts).toEqual([{ ...WORK, signedDocumentId: DOCUMENT }])
  })

  it('이미 넣었거나 수신자가 직원이 아니면 아무것도 하지 않습니다', () => {
    expect(decideSignedDocumentIntake(REQUEST, DOCUMENT, { ...FACTS, alreadyFiled: true }, AT)).toBeUndefined()
    expect(decideSignedDocumentIntake({ ...REQUEST, employeeId: undefined }, DOCUMENT, FACTS, AT)).toBeUndefined()
  })

  it('무효가 먼저 왔으면 문서를 무효로 넣고 계약에 잇지 않습니다', () => {
    const decision = decideSignedDocumentIntake(REQUEST, DOCUMENT, { ...FACTS, voidedAt: AT }, AT)
    expect(decision?.document).toMatchObject({ status: 'VOIDED', voidedAt: AT })
    expect(decision?.workContracts).toEqual([])
  })

  it('무효로 두면 아직 그 문서를 가리키는 계약에서만 서명 문서를 풉니다', () => {
    const filed = decideSignedDocumentIntake(REQUEST, DOCUMENT, FACTS, AT)!
    const stillLinked = decideSignedDocumentVoid(
      filed.document,
      { workContracts: filed.workContracts, payrollContracts: [] },
      LATER,
      LATER,
    )
    const resigned = decideSignedDocumentVoid(
      filed.document,
      { workContracts: [{ ...WORK, signedDocumentId: OTHER_DOCUMENT }], payrollContracts: [] },
      LATER,
      LATER,
    )
    expect(stillLinked?.document).toMatchObject({ status: 'VOIDED', voidedAt: LATER })
    expect(stillLinked?.workContracts.map((contract) => contract.signedDocumentId)).toEqual([undefined])
    expect(resigned?.workContracts).toEqual([])
    expect(
      decideSignedDocumentVoid(stillLinked!.document, { workContracts: [], payrollContracts: [] }, LATER, LATER),
    ).toBeUndefined()
  })
})
