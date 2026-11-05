import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LEGACY_FILING_KIND, LEGACY_FILING_STATUS, LEGACY_TAX_TYPE, LEGACY_TRANSITION } from '../legacy-names.ts'
import type { FilingActorKind } from '../tax.types.ts'
import { transitionFiling } from './filing-status.ts'
import type { FilingTransitionResult } from './filing-status.types.ts'

/**
 * 현행 구현 픽스처(`test/fixtures/rules/filing-status-transitions.json`)를 서버 전이표로 옮긴 테스트입니다.
 *
 * 현행 이름(소문자 상태, camelCase 전이)을 재설계 enum으로 바꾸고, 결정
 * (`docs/design/rule-decisions/tax.md`의 filing-status-transitions)에 따라 기대값을 정합니다.
 */

interface FixtureCase {
  name: string
  input: Record<string, any>
  expected: Record<string, any>
}

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../../../test/fixtures/rules/filing-status-transitions.json'), 'utf8'),
) as { cases: FixtureCase[] }

/** 현행 오류 코드 → 재설계 오류 코드입니다. 행위자 불일치는 권한 오류와 구분합니다(결정 7). */
const ERROR_CODE: Record<string, string> = {
  PERMISSION_DENIED: 'FILING_ACTOR_NOT_ALLOWED',
  INVALID_TRANSITION: 'FILING_TRANSITION_INVALID',
  VALIDATION_FAILED: 'FILING_REQUIREMENTS_PENDING',
}

/** 결정으로 기대값이 바뀐 케이스입니다. */
const CHANGED: Record<string, { ok: boolean; to?: string; code?: string }> = {
  'request materials for a notice filing': { ok: false, code: 'FILING_TRANSITION_INVALID' },
  'cancel submitted': { ok: true, to: 'CANCELED' },
}

/** 서버 테스트로 옮기지 않은 케이스와 그 이유입니다. 픽스처에 케이스가 늘면 아래 검사가 실패합니다. */
const NOT_PORTED: Record<string, string> = {
  'file without a return document':
    '`:file`이 `returnFileId`를 필수로 받아 신고서 없는 요청은 400입니다(결정 5). filings.http.test.ts가 검사합니다',
}

function expectedOf(testCase: FixtureCase): { ok: boolean; to?: string; code?: string } {
  const changed = CHANGED[testCase.name]
  if (changed !== undefined) return changed
  const { expected } = testCase
  if (expected['ok'] === true) return { ok: true, to: LEGACY_FILING_STATUS[expected['to']]! }
  return { ok: false, code: ERROR_CODE[expected['code']]! }
}

function actual(result: FilingTransitionResult): { ok: boolean; to?: string; code?: string } {
  return result.ok ? { ok: true, to: result.to } : { ok: false, code: result.code }
}

const ported = fixture.cases.filter((testCase) => !(testCase.name in NOT_PORTED))

describe('filing-status-transitions fixture', () => {
  it.each(ported.map((testCase) => [testCase.name, testCase] as const))('%s', (_, testCase) => {
    const { input } = testCase
    const result = transitionFiling(
      LEGACY_FILING_STATUS[input['status']]!,
      LEGACY_TRANSITION[input['transition']]!,
      input['actor'].toUpperCase() as FilingActorKind,
      {
        taxType: LEGACY_TAX_TYPE[input['taxType']]!,
        kind: LEGACY_FILING_KIND[input['kind']]!,
        payableAmount: input['payableAmount'],
        pendingRequirementCodes: Array.from({ length: input['pendingClientItems'] }, (_, index) => `ITEM_${index}`),
      },
    )

    expect(actual(result)).toEqual(expectedOf(testCase))
  })

  it('accounts for every case that is not ported', () => {
    const names = new Set(ported.map((testCase) => testCase.name))
    const rest = fixture.cases.map((testCase) => testCase.name).filter((name) => !names.has(name))

    expect(rest.sort()).toEqual(Object.keys(NOT_PORTED).sort())
  })

  it('names only cases that exist as changed', () => {
    const names = new Set(fixture.cases.map((testCase) => testCase.name))

    expect(Object.keys(CHANGED).filter((name) => !names.has(name))).toEqual([])
  })
})
