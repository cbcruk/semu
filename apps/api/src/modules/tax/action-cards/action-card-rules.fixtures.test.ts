import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LEGACY_TRANSITION } from '../legacy-names.ts'
import type { FilingActorKind, FilingDocumentType } from '../tax.types.ts'
import {
  compareClosedCards,
  compareOpenCards,
  completedCardStatus,
  documentViewClosesReviewCard,
  filingCardEffects,
  openCardState,
} from './action-card-rules.ts'
import type { ActionCardCompletion, ActionCardEffect, ActionCardStatus } from './action-card-rules.types.ts'

/**
 * 현행 구현 픽스처(`test/fixtures/rules/action-card-lifecycle.json`)를 서버 규칙으로 옮긴 테스트입니다.
 *
 * 현행 소문자 카드 종류·상태를 대문자 enum으로 바꿔 비교합니다 (`docs/design/rule-decisions/tax.md`의 action-card-lifecycle).
 */

interface FixtureCase {
  name: string
  input: Record<string, any>
  expected: Record<string, any>
}

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../../../test/fixtures/rules/action-card-lifecycle.json'), 'utf8'),
) as { cases: FixtureCase[] }

/** 서버 테스트로 옮기지 않은 케이스와 그 이유입니다. 픽스처에 케이스가 늘면 아래 검사가 실패합니다. */
const NOT_PORTED: Record<string, string> = {
  'complete a closed card': '서비스가 409 `ACTION_CARD_CLOSED`로 막습니다. action-cards.http.test.ts가 검사합니다',
  'card of a menu the user cannot open is hidden':
    '메뉴 코드 대신 카드의 권한·플랜 요건으로 거릅니다(결정 5). action-cards.http.test.ts가 검사합니다',
  'card of an accessible menu is shown': '위와 같습니다',
}

function cases(check: string): FixtureCase[] {
  return fixture.cases.filter((testCase) => testCase.input['check'] === check && !(testCase.name in NOT_PORTED))
}

function legacyEffect(effect: ActionCardEffect): Record<string, unknown> {
  switch (effect.op) {
    case 'OPEN':
      return { op: 'open', kind: effect.kind.toLowerCase(), dueDate: effect.dueDate }
    case 'CLOSE':
      return { op: 'close', kind: effect.kind.toLowerCase() }
    case 'CLOSE_ALL':
      return { op: 'close_all' }
  }
}

describe('할 일 카드 수명 주기 픽스처(action-card-lifecycle)', () => {
  it.each(cases('effects').map((testCase) => [testCase.name, testCase] as const))('%s', (_, { input, expected }) => {
    const trigger =
      input['transition'] === 'scheduleCancel' ? 'SCHEDULE_CANCELED' : LEGACY_TRANSITION[input['transition']]!

    expect(filingCardEffects(trigger, input['filing']).map(legacyEffect)).toEqual(expected['effects'])
  })

  it.each(cases('complete').map((testCase) => [testCase.name, testCase] as const))('%s', (_, { input, expected }) => {
    const status = completedCardStatus(
      input['completionReason'].toUpperCase() as ActionCardCompletion,
      input['dueDate'],
      input['today'],
    )

    expect(status).toBe(expected['status'].toUpperCase())
  })

  it.each(cases('reopen').map((testCase) => [testCase.name, testCase] as const))('%s', (_, { input, expected }) => {
    const existing = input['existing']
    const state = openCardState(
      { ...existing, status: existing['status'].toUpperCase() as ActionCardStatus, completedAt: null },
      input['dueDate'],
    )

    expect(state).toEqual({ ...expected, status: expected['status'].toUpperCase() })
  })

  it.each(cases('document-view').map((testCase) => [testCase.name, testCase] as const))(
    '%s',
    (_, { input, expected }) => {
      const closes = documentViewClosesReviewCard(
        input['docType'].toUpperCase() as FilingDocumentType,
        input['viewer'].toUpperCase() as FilingActorKind,
      )

      expect(closes).toBe(expected['closesReviewCard'])
    },
  )

  it.each(cases('order').map((testCase) => [testCase.name, testCase] as const))('%s', (_, { input, expected }) => {
    const cards = (input['cards'] as Record<string, any>[]).map((card) => ({
      id: card['id'],
      dueDate: card['dueDate'] ?? null,
      createdAt: card['createdAt'] ?? '',
      completedAt: card['completedAt'] ?? null,
    }))
    const sorted = [...cards].sort(input['tab'] === 'active' ? compareOpenCards : compareClosedCards)

    expect(sorted.map((card) => card.id)).toEqual(expected['ids'])
  })

  it('서버 테스트로 옮기지 않은 사례는 모두 이유가 적혀 있습니다', () => {
    const checks = ['effects', 'complete', 'reopen', 'document-view', 'order']
    const ported = new Set(checks.flatMap((check) => cases(check).map((testCase) => testCase.name)))
    const rest = fixture.cases.map((testCase) => testCase.name).filter((name) => !ported.has(name))

    expect(rest.sort()).toEqual(Object.keys(NOT_PORTED).sort())
  })
})
