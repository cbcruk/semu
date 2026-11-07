import { describe, expect, it } from 'vitest'
import { decideAccess } from './authorization.ts'
import { testActor } from './testing.ts'

describe('접근 판정', () => {
  it('권한보다 플랜을 먼저 물어 클라이언트가 업셀 안내를 띄울 수 있게 합니다', () => {
    const actor = testActor({ permissions: new Set(), plans: new Set() })

    expect(decideAccess(actor, { permission: 'employee:read', plans: ['PAYROLL'] })?._tag).toBe('EntitlementRequired')
  })

  it('리소스 와일드카드 권한을 받아들입니다', () => {
    const actor = testActor({ permissions: new Set(['employee:*']) })

    expect(decideAccess(actor, { permission: 'employee:update' })).toBeUndefined()
    expect(decideAccess(actor, { permission: 'payroll-ledger:read' })?._tag).toBe('PermissionDenied')
  })

  it('고객은 약관 동의 전에 막고 세무 대리인 담당자는 통과시킵니다', () => {
    const pending = { pendingTermCodes: ['TAX_SERVICE'] }

    expect(decideAccess(testActor(pending), { permission: 'filing:read', requiresTerms: true })?._tag).toBe(
      'TermsReagreementRequired',
    )
    expect(
      decideAccess(testActor({ ...pending, kind: 'AGENCY' }), { permission: 'filing:read', requiresTerms: true }),
    ).toBeUndefined()
  })

  it('데모 계정은 읽기만 하고 쓰기는 못 합니다', () => {
    const demo = testActor({ isDemo: true })

    expect(decideAccess(demo, { permission: 'employee:read' })).toBeUndefined()
    expect(decideAccess(demo, { permission: 'employee:create' })?._tag).toBe('PermissionDenied')
  })
})
