import { describe, expect, it } from 'vitest'
import { decideAccess } from './authorization.ts'
import { testActor } from './testing.ts'

describe('decideAccess', () => {
  it('asks for the plan before the permission so the client can upsell', () => {
    const actor = testActor({ permissions: new Set(), plans: new Set() })

    expect(decideAccess(actor, { permission: 'employee:read', plans: ['PAYROLL'] })?._tag).toBe('EntitlementRequired')
  })

  it('accepts a resource wildcard', () => {
    const actor = testActor({ permissions: new Set(['employee:*']) })

    expect(decideAccess(actor, { permission: 'employee:update' })).toBeUndefined()
    expect(decideAccess(actor, { permission: 'payroll-ledger:read' })?._tag).toBe('PermissionDenied')
  })

  it('holds clients to the terms gate but lets agency staff through', () => {
    const pending = { pendingTermCodes: ['TAX_SERVICE'] }

    expect(decideAccess(testActor(pending), { permission: 'filing:read', requiresTerms: true })?._tag).toBe(
      'TermsReagreementRequired',
    )
    expect(
      decideAccess(testActor({ ...pending, kind: 'AGENCY' }), { permission: 'filing:read', requiresTerms: true }),
    ).toBeUndefined()
  })

  it('lets demo accounts read but not write', () => {
    const demo = testActor({ isDemo: true })

    expect(decideAccess(demo, { permission: 'employee:read' })).toBeUndefined()
    expect(decideAccess(demo, { permission: 'employee:create' })?._tag).toBe('PermissionDenied')
  })
})
