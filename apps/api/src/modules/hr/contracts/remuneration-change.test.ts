import { describe, expect, it } from 'vitest'
import { remunerationChanges, type RemunerationTerms } from './remuneration-change.ts'

const terms = (id: string, startDate: string, amount: number, wageType: RemunerationTerms['wageType'] = 'MONTHLY') => ({
  id,
  startDate,
  wageType,
  amount,
})
const always = () => true

describe('보수 변경 신고 대상', () => {
  it('가장 이른 계약은 빼고 직전 계약과 보수가 다른 계약만 고릅니다', () => {
    const changes = remunerationChanges(
      [terms('c', '2027-01-01', 3_300_000), terms('a', '2026-01-02', 3_000_000), terms('b', '2026-07-01', 3_300_000)],
      always,
    )

    expect(changes).toEqual([
      { contractId: 'b', payload: { effectiveFrom: '2026-07-01', wageType: 'MONTHLY', amount: 3_300_000 } },
    ])
  })

  it('금액이 같아도 지급 단위가 바뀌면 변경입니다', () => {
    const changes = remunerationChanges(
      [terms('a', '2026-01-02', 10_320, 'HOURLY'), terms('b', '2026-07-01', 10_320, 'DAILY')],
      always,
    )
    expect(changes.map((change) => change.contractId)).toEqual(['b'])
  })

  it('소급 등록한 계약이 가장 이르면 그 계약이 아니라 다음 계약이 대상입니다', () => {
    const changes = remunerationChanges(
      [terms('late', '2026-07-01', 3_300_000), terms('early', '2026-01-02', 3_000_000)],
      always,
    )
    expect(changes.map((change) => change.contractId)).toEqual(['late'])
  })

  it('그날 4대보험에 가입하지 않은 계약은 뺍니다', () => {
    const changes = remunerationChanges(
      [terms('a', '2026-01-02', 3_000_000), terms('b', '2026-07-01', 3_300_000), terms('c', '2027-01-01', 3_600_000)],
      (date) => date !== '2026-07-01',
    )
    expect(changes.map((change) => change.contractId)).toEqual(['c'])
  })
})
