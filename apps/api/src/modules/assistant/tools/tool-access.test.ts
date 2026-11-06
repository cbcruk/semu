import { describe, expect, it } from 'vitest'
import type { GrantedPermission, Plan } from '../../identity-access/actor.types.ts'
import { allowedTools } from './tool-access.ts'

const tools = (permissions: GrantedPermission[], plans: Plan[]): string[] =>
  allowedTools({ permissions: new Set(permissions), plans: new Set(plans) }).map((allowed) => allowed.tool)

describe('allowedTools', () => {
  it('gives a free admin knowledge, finance summary and tax invoice issuing', () => {
    expect(tools(['*'], [])).toEqual(['KNOWLEDGE_QA', 'FINANCE_SUMMARY', 'ISSUE_TAX_INVOICE'])
  })

  it('adds certificate requests and payroll lookups for tax bookkeeping customers', () => {
    expect(tools(['*'], ['TAXATION'])).toEqual([
      'KNOWLEDGE_QA',
      'FINANCE_SUMMARY',
      'ISSUE_TAX_INVOICE',
      'REQUEST_CERTIFICATE',
      'LOOKUP_PAYROLL',
    ])
  })

  it('opens payroll lookups to the payroll plan alone', () => {
    expect(tools(['*'], ['PAYROLL'])).toContain('LOOKUP_PAYROLL')
    expect(tools(['*'], ['PAYROLL'])).not.toContain('REQUEST_CERTIFICATE')
  })

  it('narrows tools to the permissions of the same work outside the assistant', () => {
    expect(tools(['conversation:create'], ['TAXATION', 'PAYROLL'])).toEqual(['KNOWLEDGE_QA'])
    expect(tools(['conversation:create', 'bank-transaction:*'], [])).toEqual(['KNOWLEDGE_QA', 'FINANCE_SUMMARY'])
  })

  it('marks write tools as needing confirmation', () => {
    const modes = Object.fromEntries(
      allowedTools({ permissions: new Set(['*']), plans: new Set(['TAXATION']) }).map((t) => [t.tool, t.mode]),
    )

    expect(modes).toMatchObject({
      ISSUE_TAX_INVOICE: 'CONFIRM',
      REQUEST_CERTIFICATE: 'CONFIRM',
      FINANCE_SUMMARY: 'READ',
    })
  })
})
