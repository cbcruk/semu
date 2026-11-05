import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** 규칙 픽스처 한 사례입니다. */
export interface RuleFixtureCase<I, E> {
  name: string
  input: I
  expected: E
}

const FIXTURE_DIR = join(import.meta.dirname, '..', '..', '..', 'test', 'fixtures', 'rules')

/** `apps/api/test/fixtures/rules/<rule>.json`의 사례를 읽습니다. 픽스처 테스트가 씁니다. */
export function loadRuleCases<I, E>(rule: string): RuleFixtureCase<I, E>[] {
  const fixture = JSON.parse(readFileSync(join(FIXTURE_DIR, `${rule}.json`), 'utf8')) as {
    cases: RuleFixtureCase<I, E>[]
  }
  return fixture.cases
}
