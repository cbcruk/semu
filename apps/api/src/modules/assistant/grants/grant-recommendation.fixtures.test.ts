import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAX_RECOMMENDATIONS, openGrants, recommendGrants } from './grant-recommendation.ts'
import type { GrantProfile, GrantWindow } from './grant-recommendation.types.ts'

interface FixtureInput {
  side: 'manual' | 'legacy'
  list: 'all' | 'tailored'
  today?: string
  company?: GrantProfile
  grants?: GrantWindow[]
  grantsMatching?: number
}

interface FixtureCase {
  name: string
  input: FixtureInput
  expected: unknown
}

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../../../test/fixtures/rules/grant-recommendation.json'), 'utf8'),
) as { cases: FixtureCase[] }

/** 서버가 현행과 다르게 동작하는 케이스와 새 기대값입니다 (`docs/design/rule-decisions/assistant.md`). */
const CHANGED: Record<string, unknown> = {
  'legacy: unclear industry matches only grants without industry limit': ['g1', 'g2'],
  'legacy: call not started yet is still recommended': [],
}

/** 서버 규칙으로 옮기지 않은 케이스입니다. */
const NOT_PORTED: Record<string, string> = {
  'list refreshes daily at 04:00': '공고 수집 스케줄은 GrantFeed 작업의 몫이고 규칙 함수 밖입니다',
}

const ported = fixture.cases.filter((testCase) => !(testCase.name in NOT_PORTED))

function run(input: FixtureInput): unknown {
  const today = input.today ?? '2026-11-05'
  if (input.grantsMatching !== undefined) {
    const grants = Array.from({ length: input.grantsMatching }, (_, index) => ({
      id: `g${index}`,
      applyStartOn: '2026-11-01',
      applyEndOn: null,
      industryCodes: [],
      regionCodes: [],
    }))
    return { count: recommendGrants(grants, input.company ?? { industryCodes: [], regionCode: null }, today).length }
  }
  const grants = input.grants ?? []
  const result =
    input.list === 'all'
      ? openGrants(grants, today)
      : recommendGrants(grants, input.company ?? { industryCodes: [], regionCode: null }, today)
  return result.map((grant) => grant.id)
}

describe('지원사업 추천 픽스처', () => {
  it.each(ported.map((testCase) => [testCase.name, testCase] as const))('%s', (name, testCase) => {
    expect(run(testCase.input)).toEqual(name in CHANGED ? CHANGED[name] : testCase.expected)
  })

  it('바꾼 사례와 옮기지 않은 사례는 픽스처에 있는 이름만 적습니다', () => {
    const names = new Set(fixture.cases.map((testCase) => testCase.name))
    for (const name of [...Object.keys(CHANGED), ...Object.keys(NOT_PORTED)]) expect(names).toContain(name)
    expect(MAX_RECOMMENDATIONS).toBe(15)
  })
})
