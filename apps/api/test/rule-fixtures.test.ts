import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

interface RuleFixture {
  rule: string
  description: string
  sources: { file: string; lines: string; origin?: string }[]
  cases: { name: string; input: unknown; expected: unknown; derivation: 'executed' | 'traced' }[]
  openQuestions: string[]
}

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..')
const FIXTURE_DIR = join(import.meta.dirname, 'fixtures', 'rules')
const RULE_DOC_DIR = join(REPO_ROOT, 'docs', 'reference', 'rules')

/** 지운 자료입니다. 이 경로의 출처는 적힌 커밋의 트리에 있어 작업 트리에서 확인하지 않습니다. */
const REMOVED_SOURCE_PREFIXES = [
  'apps/api/legacy/', // f115042
  'docs/reference/legacy-design/', // 3c6f890
]

const sourceExists = (file: string) =>
  REMOVED_SOURCE_PREFIXES.some((prefix) => file.startsWith(prefix)) || existsSync(join(REPO_ROOT, file))

const files = readdirSync(FIXTURE_DIR).filter((file) => file.endsWith('.json'))

describe('규칙 픽스처', () => {
  it('픽스처 파일이 하나 이상 있습니다', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(files)('%s 픽스처는 형식이 맞고 출처·규칙 문서가 있습니다', (file) => {
    const fixture = JSON.parse(readFileSync(join(FIXTURE_DIR, file), 'utf8')) as RuleFixture

    expect(fixture.rule).toBe(file.replace(/\.json$/, ''))
    expect(fixture.description).toEqual(expect.any(String))
    expect(fixture.sources.length).toBeGreaterThan(0)
    for (const source of fixture.sources) expect(sourceExists(source.file), source.file).toBe(true)
    expect(fixture.cases.length).toBeGreaterThan(0)
    expect(Array.isArray(fixture.openQuestions)).toBe(true)

    const names = fixture.cases.map((testCase) => testCase.name)
    expect(new Set(names).size).toBe(names.length)
    for (const testCase of fixture.cases) {
      expect(['executed', 'traced']).toContain(testCase.derivation)
      expect(testCase).toHaveProperty('input')
      expect(testCase).toHaveProperty('expected')
    }

    expect(existsSync(join(RULE_DOC_DIR, `${fixture.rule}.md`))).toBe(true)
  })
})
