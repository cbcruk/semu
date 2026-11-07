import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LEGACY_FILING_KIND, LEGACY_TAX_TYPE } from '../legacy-names.ts'
import {
  answerRequirement,
  payrollLedgerResponse,
  requirementTemplate,
  responseAfterFiles,
} from './filing-requirements.ts'
import type { RequirementAnswer } from './filing-requirements.types.ts'

/**
 * 현행 구현 픽스처(`test/fixtures/rules/filing-requirements.json`)를 서버 규칙으로 옮긴 테스트입니다.
 *
 * 항목 코드와 응답은 대문자 enum으로, 현행 `VALIDATION_FAILED`(필드 `response`·`code`)는 도메인 오류 코드로 바꿉니다
 * (`docs/design/rule-decisions/tax.md`의 filing-requirements).
 */

interface FixtureCase {
  name: string
  input: Record<string, any>
  expected: Record<string, any>
}

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../../../test/fixtures/rules/filing-requirements.json'), 'utf8'),
) as { cases: FixtureCase[] }

/** 현행 422 필드 오류 → 재설계 도메인 오류입니다. */
const FIELD_ERROR: Record<string, string> = {
  response: 'REQUIREMENT_HAS_FILES',
  code: 'REQUIREMENT_AUTO_LINKED',
}

/** 현행 급여대장 상태 중 마감으로 보는 값입니다. BPO `approved`와 레거시 `완료`입니다. */
const CLOSED_LEDGER = new Set(['approved', '완료'])

function cases(check: string): FixtureCase[] {
  return fixture.cases.filter((testCase) => testCase.input['check'] === check)
}

describe('제출 자료 항목 픽스처(filing-requirements)', () => {
  it.each(cases('template').map((testCase) => [testCase.name, testCase] as const))('%s', (_, { input, expected }) => {
    const codes = requirementTemplate(
      LEGACY_TAX_TYPE[input['taxType']]!,
      LEGACY_FILING_KIND[input['kind']]!,
      input['hasPayrollPlan'],
    ).map((template) => template.code)

    expect(codes).toEqual((expected['codes'] as string[]).map((code) => code.toUpperCase()))
  })

  it.each(cases('answer').map((testCase) => [testCase.name, testCase] as const))('%s', (_, { input, expected }) => {
    const result = answerRequirement(
      { autoLinked: input['autoLinked'], fileCount: input['fileCount'] },
      input['response'].toUpperCase() as RequirementAnswer,
    )

    expect(result).toEqual(
      expected['ok'] === true
        ? { ok: true, response: expected['response'].toUpperCase() }
        : { ok: false, code: FIELD_ERROR[expected['field']] },
    )
  })

  it.each(cases('files').map((testCase) => [testCase.name, testCase] as const))('%s', (_, { input, expected }) => {
    const after = input['fileCountBefore'] + (input['op'] === 'attach' ? 1 : -1)

    expect(responseAfterFiles(after)).toBe(expected['response'].toUpperCase())
  })

  it.each(cases('payroll-ledger').map((testCase) => [testCase.name, testCase] as const))(
    '%s',
    (_, { input, expected }) => {
      const statuses = input['ledgerStatuses'] as string[]
      const response = payrollLedgerResponse({
        ledgerCount: statuses.length,
        closedCount: statuses.filter((status) => CLOSED_LEDGER.has(status)).length,
      })

      expect(response).toBe(expected['response'].toUpperCase())
    },
  )

  it('픽스처의 사례를 모두 옮겼습니다', () => {
    const checks = new Set(['template', 'answer', 'files', 'payroll-ledger'])

    expect(fixture.cases.filter((testCase) => !checks.has(testCase.input['check']))).toEqual([])
  })
})
