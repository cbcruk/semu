import { describe, expect, it } from 'vitest'
import type { GrantedPermission, Plan } from '../../identity-access/actor.types.ts'
import { allowedTools } from './tool-access.ts'

const tools = (permissions: GrantedPermission[], plans: Plan[]): string[] =>
  allowedTools({ permissions: new Set(permissions), plans: new Set(plans) }).map((allowed) => allowed.tool)

describe('비서 도구 허용', () => {
  it('무료 고객의 관리자는 세무·노무 문의, 재무 요약, 세금계산서 발행을 씁니다', () => {
    expect(tools(['*'], [])).toEqual(['KNOWLEDGE_QA', 'FINANCE_SUMMARY', 'ISSUE_TAX_INVOICE'])
  })

  it('세무 기장 고객은 증명서 발급 요청과 직원·급여 조회를 더 씁니다', () => {
    expect(tools(['*'], ['TAXATION'])).toEqual([
      'KNOWLEDGE_QA',
      'FINANCE_SUMMARY',
      'ISSUE_TAX_INVOICE',
      'REQUEST_CERTIFICATE',
      'LOOKUP_PAYROLL',
    ])
  })

  it('급여 플랜만 있어도 직원·급여 조회를 씁니다', () => {
    expect(tools(['*'], ['PAYROLL'])).toContain('LOOKUP_PAYROLL')
    expect(tools(['*'], ['PAYROLL'])).not.toContain('REQUEST_CERTIFICATE')
  })

  it('도구는 비서 밖에서 같은 일을 할 때의 권한으로 좁힙니다', () => {
    expect(tools(['conversation:create'], ['TAXATION', 'PAYROLL'])).toEqual(['KNOWLEDGE_QA'])
    expect(tools(['conversation:create', 'bank-transaction:*'], [])).toEqual(['KNOWLEDGE_QA', 'FINANCE_SUMMARY'])
  })

  it('쓰기 도구는 사용자 확인이 필요하다고 표시합니다', () => {
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
