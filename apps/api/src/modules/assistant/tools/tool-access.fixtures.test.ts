import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Permission, Plan } from '../../identity-access/actor.types.ts'
import { decideAccess } from '../../identity-access/authorization.ts'
import { testActor } from '../../identity-access/testing.ts'
import type { AssistantTool } from './assistant-tool.types.ts'
import { ASSISTANT_ENTRY } from '../conversations/conversation.ts'
import { allowedTools, TOOL_REQUIREMENTS } from './tool-access.ts'

interface FixtureInput {
  side: 'bundle' | 'manual' | 'legacy'
  actor?: { kind?: 'client' | 'agency'; isAdmin?: boolean; isSystemAdmin?: boolean; roleMenuCodes?: string[] }
  company?: { taxPlan?: 'taxation' | null; hasPayrollPlan?: boolean }
  toolCall?: { tool: string; requiresConfirmation: boolean }
}

interface FixtureCase {
  name: string
  input: FixtureInput
  expected: unknown
}

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../../../test/fixtures/rules/assistant-tool-access.json'), 'utf8'),
) as { cases: FixtureCase[] }

const LEGACY_NAMES: Record<AssistantTool, string> = {
  KNOWLEDGE_QA: 'knowledge_qa',
  FINANCE_SUMMARY: 'finance_summary',
  ISSUE_TAX_INVOICE: 'issue_tax_invoice',
  REQUEST_CERTIFICATE: 'request_certificate',
  LOOKUP_PAYROLL: 'lookup_payroll',
}

const MANUAL_NAMES: Record<AssistantTool, string> = {
  KNOWLEDGE_QA: '세무·노무 전문지식 문의',
  FINANCE_SUMMARY: '재무 정보 확인',
  ISSUE_TAX_INVOICE: '세금계산서 발행',
  REQUEST_CERTIFICATE: '증명서 발급 요청',
  LOOKUP_PAYROLL: '등록 직원 및 급여 카드 내역 조회',
}

/** 메뉴 권한이 없는 멤버가 받는 기본 권한 중 비서와 관련된 부분입니다. */
const MEMBER_BASE: Permission[] = ['company:read', 'conversation:read', 'conversation:create', 'conversation:delete']

/** 서버가 현행과 다르게 동작하는 케이스와 새 기대값입니다 (`docs/design/rule-decisions/assistant.md`). */
const CHANGED: Record<string, unknown> = {
  'bundle: admin who is not the system admin is sent to /dashboard': {
    route: 'allowed',
    topBarAiInput: 'shown',
    menuNode: 'shown',
  },
  'bundle: general member is sent to /dashboard': { route: 'allowed', topBarAiInput: 'shown', menuNode: 'shown' },
  'legacy: free admin gets knowledge and finance summary only': [
    'knowledge_qa',
    'finance_summary',
    'issue_tax_invoice',
  ],
  'legacy: taxation admin gets invoice and certificate tools': [
    'knowledge_qa',
    'finance_summary',
    'issue_tax_invoice',
    'request_certificate',
    'lookup_payroll',
  ],
  'legacy: assigned agency staff cannot open the assistant menu': { menu: 'ALLOWED' },
}

/** 서버 규칙으로 옮기지 않은 케이스입니다. */
const NOT_PORTED: Record<string, string> = {
  'bundle: home suggestion card prefills the first message':
    '화면 동작입니다. 서버는 첫 메시지로 대화를 만드는 요청만 받습니다',
  'manual: tax invoice issuing needs partners and a hometax certificate link':
    '전제 조건은 확인 후 실행하는 Bookkeeping의 세금계산서 발행 API가 판정합니다',
  'manual: knowledge answers only from trained data': '모델(RAG) 동작이라 규칙 함수로 옮길 수 없습니다',
}

function actorOf(input: FixtureInput) {
  const plans = new Set<Plan>()
  if (input.company?.taxPlan === 'taxation') plans.add('TAXATION')
  if (input.company?.hasPayrollPlan === true) plans.add('PAYROLL')
  const kind = input.actor?.kind === 'agency' ? 'AGENCY' : 'CLIENT'
  const admin = kind === 'AGENCY' || input.actor?.isAdmin !== false
  return testActor({ kind, plans, permissions: new Set<Permission>(admin ? ['*'] : MEMBER_BASE) })
}

function run(testCase: FixtureCase): unknown {
  const { input } = testCase
  if (input.toolCall !== undefined) {
    const mode = TOOL_REQUIREMENTS.ISSUE_TAX_INVOICE.mode
    return {
      executed: false,
      tool_calls: [{ tool: input.toolCall.tool, requires_confirmation: mode === 'CONFIRM' }],
    }
  }
  const actor = actorOf(input)
  if (input.side === 'bundle') {
    const allowed = decideAccess(actor, ASSISTANT_ENTRY) === undefined
    return allowed
      ? { route: 'allowed', topBarAiInput: 'shown', menuNode: 'shown' }
      : { route: 'redirect /dashboard', topBarAiInput: 'hidden', menuNode: 'excluded' }
  }
  if (input.actor?.kind === 'agency') {
    return { menu: decideAccess(actor, ASSISTANT_ENTRY) === undefined ? 'ALLOWED' : 'PERMISSION_DENIED' }
  }
  const tools = allowedTools(actor).map((allowed) => allowed.tool)
  if (input.side === 'manual') return tools.map((tool) => MANUAL_NAMES[tool]).sort()
  return tools.map((tool) => LEGACY_NAMES[tool])
}

const ported = fixture.cases.filter((testCase) => !(testCase.name in NOT_PORTED))

describe('assistant-tool-access fixtures', () => {
  it.each(ported.map((testCase) => [testCase.name, testCase] as const))('%s', (name, testCase) => {
    const expected = name in CHANGED ? CHANGED[name] : testCase.expected
    const normalized = testCase.input.side === 'manual' && Array.isArray(expected) ? [...expected].sort() : expected
    expect(run(testCase)).toEqual(normalized)
  })

  it('names only cases that exist', () => {
    const names = new Set(fixture.cases.map((testCase) => testCase.name))
    for (const name of [...Object.keys(CHANGED), ...Object.keys(NOT_PORTED)]) expect(names).toContain(name)
  })
})
