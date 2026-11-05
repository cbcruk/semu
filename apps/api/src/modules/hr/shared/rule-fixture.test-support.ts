import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

interface FixtureCase {
  name: string
  input: Record<string, unknown>
  expected: unknown
}

/**
 * 규칙 픽스처(`test/fixtures/rules/<rule>.json`)의 모든 케이스를 재설계 함수로 검사합니다.
 *
 * 픽스처는 현행 동작입니다. `changed`는 `docs/design/rule-decisions/`에서 **바꿈**으로 정한 케이스의 새 기대값이고,
 * 픽스처에 없는 이름이 있으면 테스트가 실패합니다.
 */
export function describeRuleFixture<I>(
  rule: string,
  run: (input: I) => unknown,
  changed: Readonly<Record<string, unknown>> = {},
): void {
  const fixture = JSON.parse(
    readFileSync(join(import.meta.dirname, '../../../../test/fixtures/rules', `${rule}.json`), 'utf8'),
  ) as { cases: FixtureCase[] }

  describe(`${rule} fixture`, () => {
    it.each(fixture.cases.map((testCase) => [testCase.name, testCase] as const))('%s', (name, testCase) => {
      const expected = Object.hasOwn(changed, name) ? changed[name] : testCase.expected
      expect(JSON.parse(JSON.stringify(run(testCase.input as I)) ?? 'null')).toEqual(expected)
    })

    it('names only existing cases as changed', () => {
      const names = new Set(fixture.cases.map((testCase) => testCase.name))
      expect(Object.keys(changed).filter((name) => !names.has(name))).toEqual([])
    })
  })
}
