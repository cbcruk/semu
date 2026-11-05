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

describe('isOpenOn', () => {
  it('includes the start and end days', () => {
    expect(isOpenOn({ applyStartOn: '2026-11-05', applyEndOn: '2026-11-05' }, '2026-11-05')).toBe(true)
  })

  it('excludes calls not started or already closed', () => {
    expect(isOpenOn({ applyStartOn: '2026-11-06', applyEndOn: null }, '2026-11-05')).toBe(false)
    expect(isOpenOn({ applyStartOn: '2026-10-01', applyEndOn: '2026-11-04' }, '2026-11-05')).toBe(false)
  })
})

describe('openGrants', () => {
  it('orders by deadline, always-open calls last, then by id', () => {
    const grants = [
      grant({ id: 'b' }),
      grant({ id: 'a' }),
      grant({ id: 'c', applyEndOn: '2026-12-31' }),
      grant({ id: 'd', applyEndOn: '2026-11-20' }),
    ]

    expect(openGrants(grants, '2026-11-05').map((g) => g.id)).toEqual(['d', 'c', 'a', 'b'])
  })
})

describe('matchesProfile', () => {
  it('matches industry and region codes by prefix', () => {
    const manufacturingInSeoul = grant({ id: 'g', industryCodes: ['C'], regionCodes: ['11'] })

    expect(matchesProfile(manufacturingInSeoul, { industryCodes: ['C10'], regionCode: '11680' })).toBe(true)
    expect(matchesProfile(manufacturingInSeoul, { industryCodes: ['J62'], regionCode: '11680' })).toBe(false)
    expect(matchesProfile(manufacturingInSeoul, { industryCodes: ['C10'], regionCode: '26' })).toBe(false)
  })

  it('does not filter by industry when the company industry is unclear', () => {
    expect(matchesProfile(grant({ id: 'g', industryCodes: ['C'] }), { industryCodes: [], regionCode: null })).toBe(true)
  })

  it('matches only nationwide calls when the company region is unknown', () => {
    expect(matchesProfile(grant({ id: 'g', regionCodes: ['11'] }), { industryCodes: [], regionCode: null })).toBe(false)
    expect(matchesProfile(grant({ id: 'g' }), { industryCodes: [], regionCode: null })).toBe(true)
  })
})

describe('recommendGrants', () => {
  it('keeps the 15 closest deadlines', () => {
    const grants = Array.from({ length: 20 }, (_, index) =>
      grant({ id: `g${String(index).padStart(2, '0')}`, applyEndOn: `2026-12-${String(index + 1).padStart(2, '0')}` }),
    )

    const recommended = recommendGrants(grants, { industryCodes: [], regionCode: '11' }, '2026-11-05')

    expect(recommended).toHaveLength(MAX_RECOMMENDATIONS)
    expect(recommended.at(-1)?.id).toBe('g14')
  })
})
