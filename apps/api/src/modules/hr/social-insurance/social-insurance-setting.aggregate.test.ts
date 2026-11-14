import { Result } from 'effect'
import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { decideSocialInsuranceSettingSave } from './social-insurance-setting.aggregate.ts'
import type { SocialInsuranceSettingInput } from './social-insurance-setting.ts'

const OWNER = {
  companyId: 'cmp_01JBQ000000000000000000001' as Id<'company'>,
  employeeId: 'emp_01JBQ000000000000000000001' as Id<'employee'>,
}
const AT = '2026-11-14T01:00:00.000Z'
const enrolled = { enrolled: true }
const INPUT: SocialInsuranceSettingInput = {
  effectiveFrom: '2026-01-02',
  nps: enrolled,
  nhis: enrolled,
  ei: enrolled,
  iais: enrolled,
  isRepresentativeOrExecutive: false,
  isRepresentativeRelative: false,
}

describe('4대보험 설정 저장 판정', () => {
  it('처음 저장하면 버전 1의 이력 하나를 만들고, 다른 적용일은 이력에 더해 버전을 올립니다', () => {
    const first = decideSocialInsuranceSettingSave(OWNER, undefined, INPUT, AT)
    if (Result.isFailure(first)) throw first.failure
    const second = decideSocialInsuranceSettingSave(
      OWNER,
      first.success.setting,
      { ...INPUT, effectiveFrom: '2026-07-01' },
      AT,
    )
    if (Result.isFailure(second)) throw second.failure

    expect(first.success.setting).toMatchObject({ id: OWNER.employeeId, version: 1, updatedAt: AT })
    expect(second.success.setting.version).toBe(2)
    expect(second.success.setting.entries.map((entry) => entry.effectiveFrom)).toEqual(['2026-01-02', '2026-07-01'])
  })

  it('가입하지 않는 보험에 제외 사유가 없으면 거부합니다', () => {
    const result = decideSocialInsuranceSettingSave(OWNER, undefined, { ...INPUT, ei: { enrolled: false } }, AT)
    expect(Result.isFailure(result) && result.failure).toMatchObject({
      _tag: 'SocialInsuranceSettingInvalid',
      violations: [{ field: 'ei.exclusionReason', code: 'REQUIRED' }],
    })
  })
})
