import { describe, expect, it } from 'vitest'
import { isOpenOn, matchesProfile, MAX_RECOMMENDATIONS, openGrants, recommendGrants } from './grant-recommendation.ts'
import type { GrantWindow } from './grant-recommendation.types.ts'

const grant = (overrides: Partial<GrantWindow> & { id: string }): GrantWindow => ({
  applyStartOn: '2026-11-01',
  applyEndOn: null,
  industryCodes: [],
  regionCodes: [],
  ...overrides,
})

describe('공고 신청 가능 여부', () => {
  it('신청 시작일과 마감일 당일도 신청할 수 있습니다', () => {
    expect(isOpenOn({ applyStartOn: '2026-11-05', applyEndOn: '2026-11-05' }, '2026-11-05')).toBe(true)
  })

  it('시작 전이거나 마감이 지난 공고는 신청할 수 없습니다', () => {
    expect(isOpenOn({ applyStartOn: '2026-11-06', applyEndOn: null }, '2026-11-05')).toBe(false)
    expect(isOpenOn({ applyStartOn: '2026-10-01', applyEndOn: '2026-11-04' }, '2026-11-05')).toBe(false)
  })
})

describe('전체 지원금 목록', () => {
  it('마감 임박순이고 상시 모집은 마지막, 같으면 ID순입니다', () => {
    const grants = [
      grant({ id: 'b' }),
      grant({ id: 'a' }),
      grant({ id: 'c', applyEndOn: '2026-12-31' }),
      grant({ id: 'd', applyEndOn: '2026-11-20' }),
    ]

    expect(openGrants(grants, '2026-11-05').map((g) => g.id)).toEqual(['d', 'c', 'a', 'b'])
  })
})

describe('회사 업종·지역 맞춤', () => {
  it('업종·지역 코드는 앞부분 일치로 봅니다', () => {
    const manufacturingInSeoul = grant({ id: 'g', industryCodes: ['C'], regionCodes: ['11'] })

    expect(matchesProfile(manufacturingInSeoul, { industryCodes: ['C10'], regionCode: '11680' })).toBe(true)
    expect(matchesProfile(manufacturingInSeoul, { industryCodes: ['J62'], regionCode: '11680' })).toBe(false)
    expect(matchesProfile(manufacturingInSeoul, { industryCodes: ['C10'], regionCode: '26' })).toBe(false)
  })

  it('회사 업종이 비어 있으면 업종으로 거르지 않습니다', () => {
    expect(matchesProfile(grant({ id: 'g', industryCodes: ['C'] }), { industryCodes: [], regionCode: null })).toBe(true)
  })

  it('회사 지역이 없으면 전국 공고만 맞습니다', () => {
    expect(matchesProfile(grant({ id: 'g', regionCodes: ['11'] }), { industryCodes: [], regionCode: null })).toBe(false)
    expect(matchesProfile(grant({ id: 'g' }), { industryCodes: [], regionCode: null })).toBe(true)
  })
})

describe('맞춤 추천', () => {
  it('마감이 가장 가까운 15개만 남깁니다', () => {
    const grants = Array.from({ length: 20 }, (_, index) =>
      grant({ id: `g${String(index).padStart(2, '0')}`, applyEndOn: `2026-12-${String(index + 1).padStart(2, '0')}` }),
    )

    const recommended = recommendGrants(grants, { industryCodes: [], regionCode: '11' }, '2026-11-05')

    expect(recommended).toHaveLength(MAX_RECOMMENDATIONS)
    expect(recommended.at(-1)?.id).toBe('g14')
  })
})
