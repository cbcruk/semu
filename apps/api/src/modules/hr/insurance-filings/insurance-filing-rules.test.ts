import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { applyInsuranceFilingCommand, lossDateOf } from './insurance-filing-rules.ts'
import type { InsuranceFiling, InsuranceFilingStatus } from './insurance-filing.types.ts'

const AT = '2026-11-12T00:00:00.000Z'

const filing = (status: InsuranceFilingStatus, resultMessage?: string): InsuranceFiling => ({
  id: 'isf_1' as Id<'insuranceFiling'>,
  companyId: 'cmp_1' as Id<'company'>,
  employeeId: 'emp_1' as Id<'employee'>,
  kind: 'ACQUISITION',
  source: { type: 'EMPLOYEE', id: 'emp_1' },
  payload: { acquisitionDate: '2026-01-02' },
  status,
  requestedAt: '2026-01-02T00:00:00.000Z',
  ...(resultMessage === undefined ? {} : { resultMessage }),
})

describe('4대보험 신고 처리', () => {
  it('대기 중인 신고를 완료합니다', () => {
    expect(applyInsuranceFilingCommand(filing('PENDING'), { type: 'COMPLETE' }, AT)).toMatchObject({
      status: 'DONE',
      processedAt: AT,
    })
  })

  it('실패 사유를 남기고, 실패한 신고를 다시 완료하면 사유를 지웁니다', () => {
    const failed = applyInsuranceFilingCommand(filing('PENDING'), { type: 'FAIL', message: '주민번호 불일치' }, AT)
    expect(failed).toMatchObject({ status: 'FAILED', resultMessage: '주민번호 불일치' })

    const done = applyInsuranceFilingCommand(failed!, { type: 'COMPLETE' }, AT)
    expect(done?.status).toBe('DONE')
    expect(done).not.toHaveProperty('resultMessage')
  })

  it('실패한 신고를 다시 실패로 두면 사유만 바뀝니다', () => {
    expect(
      applyInsuranceFilingCommand(filing('FAILED', '처음 사유'), { type: 'FAIL', message: '다른 사유' }, AT),
    ).toMatchObject({ status: 'FAILED', resultMessage: '다른 사유' })
  })

  it.each(['DONE', 'WITHDRAWN'] as const)('닫힌 신고(%s)는 처리하지 않습니다', (status) => {
    expect(applyInsuranceFilingCommand(filing(status), { type: 'COMPLETE' }, AT)).toBeUndefined()
    expect(applyInsuranceFilingCommand(filing(status), { type: 'FAIL', message: '사유' }, AT)).toBeUndefined()
  })

  it('자격 상실일은 퇴직일 다음 날입니다', () => {
    expect(lossDateOf('2026-12-31')).toBe('2027-01-01')
    expect(lossDateOf('2028-02-28')).toBe('2028-02-29')
  })
})
