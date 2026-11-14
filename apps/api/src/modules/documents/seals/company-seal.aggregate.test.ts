import { Result } from 'effect'
import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { decideSealRegistration, decideSealRemoval } from './company-seal.aggregate.ts'
import { DEMO_COMPANY_SEALS, type CompanySealRecord } from './company-seal.ts'

const input = {
  id: 'sel_01JBQ000000000000000000009' as Id<'companySeal'>,
  companyId: 'cmp_01JBQ000000000000000000001' as Id<'company'>,
  name: '대표 사인',
  source: 'DRAWN' as const,
  imageFileId: 'fle_01JBQ000000000000000000009' as Id<'file'>,
  createdAt: '2026-11-14T00:00:00.000Z',
}
const seal: CompanySealRecord = DEMO_COMPANY_SEALS[0]!

describe('decideSealRegistration', () => {
  it('지우지 않은 도장이 다섯 개 미만이면 받은 값 그대로 등록합니다', () => {
    const decision = Result.getOrThrow(decideSealRegistration(input, 4))

    expect(decision.seal).toEqual(input)
  })

  it('지우지 않은 도장이 다섯 개면 한도 초과로 거부합니다', () => {
    const result = decideSealRegistration(input, 5)

    expect(Result.isFailure(result) && result.failure._tag).toBe('CompanySealLimitExceeded')
  })
})

describe('decideSealRemoval', () => {
  it('지우지 않고 삭제 시각을 남깁니다', () => {
    const decision = Result.getOrThrow(decideSealRemoval(seal, '2026-11-14T01:00:00.000Z'))

    expect(decision.seal).toEqual({ ...seal, deletedAt: '2026-11-14T01:00:00.000Z' })
  })

  it('이미 지운 도장은 없는 것과 같습니다', () => {
    const result = decideSealRemoval({ ...seal, deletedAt: '2026-11-13T00:00:00.000Z' }, '2026-11-14T01:00:00.000Z')

    expect(Result.isFailure(result) && result.failure._tag).toBe('CompanySealNotFound')
  })
})
