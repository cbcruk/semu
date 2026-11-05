import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** 규칙 픽스처의 케이스 하나입니다. */
export interface FixtureCase {
  name: string
  input: Record<string, unknown>
  expected: unknown
}

/** `apps/api/test/fixtures/rules/<rule>.json`의 케이스를 읽습니다. 픽스처 테스트에서만 씁니다. */
export function loadRuleCases(rule: string): FixtureCase[] {
  const path = join(import.meta.dirname, '../../../test/fixtures/rules', `${rule}.json`)
  return (JSON.parse(readFileSync(path, 'utf8')) as { cases: FixtureCase[] }).cases
}
