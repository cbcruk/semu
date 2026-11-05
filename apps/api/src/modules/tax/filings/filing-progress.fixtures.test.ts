import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LEGACY_FILING_STATUS, LEGACY_TAX_TYPE } from '../legacy-names.ts'
import { filingProgress, isFilingOverdue } from './filing-progress.ts'
import type { FilingStage } from './filing-progress.types.ts'

/**
 * 현행 구현 픽스처(`test/fixtures/rules/filing-progress.json`)를 서버 규칙으로 옮긴 테스트입니다.
 *
 * 현행은 단계 이름 문구를 내려줬고, 재설계는 단계 코드를 내려줍니다(`docs/design/rule-decisions/tax.md`의 filing-progress 1).
 * 문구 → 코드 표로 바꿔 같은 단계인지 검사합니다.
 */

interface FixtureCase {
  name: string
  input: Record<string, any>
  expected: Record<string, any>
}

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../../../test/fixtures/rules/filing-progress.json'), 'utf8'),
) as { cases: FixtureCase[] }

const STAGE_OF_LABEL: Record<string, FilingStage> = {
  '자료 제출 가능': 'MATERIALS_OPEN',
  '자료 검토중': 'UNDER_REVIEW',
  '매입매출장 확인': 'LEDGER_CONFIRMATION',
  '부가세 작업중': 'PREPARING',
  작업중: 'PREPARING',
  '부가세 납부': 'PAYMENT',
  납부: 'PAYMENT',
  '부가세 마감': 'CLOSED',
  마감: 'CLOSED',
}

function cases(check: string): FixtureCase[] {
  return fixture.cases.filter((testCase) => testCase.input['check'] === check)
}

describe('filing-progress fixture', () => {
  it.each(cases('step').map((testCase) => [testCase.name, testCase] as const))('%s', (_, { input, expected }) => {
    const progress = filingProgress(LEGACY_TAX_TYPE[input['taxType']]!, LEGACY_FILING_STATUS[input['status']]!)

    expect(progress).toEqual({
      stage: expected['step'] === null ? null : STAGE_OF_LABEL[expected['step']],
      index: expected['stepIndex'],
      count: expected['stepCount'],
    })
  })

  it.each(cases('overdue').map((testCase) => [testCase.name, testCase] as const))('%s', (_, { input, expected }) => {
    const overdue = isFilingOverdue(
      { status: LEGACY_FILING_STATUS[input['status']]!, dueDate: input['dueDate'], paymentDue: input['paymentDue'] },
      input['today'],
    )

    expect(overdue).toBe(expected['isOverdue'])
  })

  it('ports every case', () => {
    expect(cases('step').length + cases('overdue').length).toBe(fixture.cases.length)
  })
})
