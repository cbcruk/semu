import { Result } from 'effect'
import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { decideTaxWithholdingSave } from './tax-withholding.aggregate.ts'
import type { TaxWithholdingInput } from './tax-withholding.ts'

const OWNER = {
  companyId: 'cmp_01JBQ000000000000000000001' as Id<'company'>,
  employeeId: 'emp_01JBQ000000000000000000001' as Id<'employee'>,
}
const AT = '2026-11-14T01:00:00.000Z'
const INPUT: TaxWithholdingInput = { effectiveFrom: '2026-01-01', calcMethod: 'TAX_TABLE' }

describe('소득세 공제 설정 저장 판정', () => {
  it('조정비율이 없으면 100%로 채우고 감면은 검증이 정한 사유·감면율로 저장합니다', () => {
    const result = decideTaxWithholdingSave(
      OWNER,
      undefined,
      {
        ...INPUT,
        reduction: {
          type: 'SMALL_BUSINESS',
          reasonCode: 'YOUTH',
          application: 'PAYROLL',
          startDate: '2026-01-01',
          endDate: '2030-12-31',
        },
      },
      AT,
    )
    if (Result.isFailure(result)) throw result.failure

    expect(result.success.entry).toMatchObject({
      effectiveFrom: '2026-01-01',
      adjustmentRatePpm: 1_000_000,
      reduction: { reasonCode: 'YOUTH', ratePpm: 900_000, application: 'PAYROLL' },
    })
    expect(result.success.setting).toMatchObject({ id: OWNER.employeeId, version: 1, entries: [result.success.entry] })
  })

  it('같은 적용일로 다시 저장하면 그 항목을 바꾸고 버전을 올립니다', () => {
    const first = decideTaxWithholdingSave(OWNER, undefined, INPUT, AT)
    if (Result.isFailure(first)) throw first.failure
    const second = decideTaxWithholdingSave(OWNER, first.success.setting, { ...INPUT, adjustmentRatePpm: 800_000 }, AT)
    if (Result.isFailure(second)) throw second.failure

    expect(second.success.setting.version).toBe(2)
    expect(second.success.setting.entries).toEqual([second.success.entry])
  })

  it('공제 설정 위반을 모두 모아 거부합니다', () => {
    const result = decideTaxWithholdingSave(
      OWNER,
      undefined,
      { ...INPUT, calcMethod: 'MANUAL', adjustmentRatePpm: 900_000 },
      AT,
    )
    expect(Result.isFailure(result) && result.failure).toMatchObject({
      _tag: 'TaxWithholdingInvalid',
      violations: [
        { field: 'manualIncomeTax', code: 'REQUIRED' },
        { field: 'adjustmentRatePpm', code: 'ADJUSTMENT_RATE_NOT_ALLOWED' },
      ],
    })
  })
})
