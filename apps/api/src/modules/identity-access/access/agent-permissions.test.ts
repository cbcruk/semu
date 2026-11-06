import { Effect, Layer, Option } from 'effect'
import { describe, expect, it } from 'vitest'
import { CurrentAgent, hasPermission } from '../actor.ts'
import type { GrantedPermission, Permission } from '../actor.types.ts'
import { authorizeAgency, decideAccess } from '../authorization.ts'
import { DEMO_COMPANY_IDS, DEMO_USER_IDS } from '../demo-seed.ts'
import { IdentityAccessMemoryLive } from '../identity-access.layer.ts'
import { AGENT_PERMISSIONS, isAgentOnly, isGrantable, permissionResource } from '../permissions/permission-catalog.ts'
import { testActor } from '../testing.ts'
import { ActorDirectory } from './actor-directory.ts'
import { actorPermissions } from './actor-permissions.ts'
import { AgentDirectory } from './agent-directory.ts'
import { CompanyPlans } from './company-plans.ts'

const agent = { permissions: actorPermissions({ kind: 'AGENCY' }) }
const admin = { permissions: actorPermissions({ kind: 'MEMBER', access: 'ADMIN', rolePermissions: [] }) }

/** 구성원 관리와 AI 비서 권한입니다. 대리인은 기본으로 갖지 않습니다. */
const MEMBER_MANAGEMENT_AND_ASSISTANT: Permission[] = [
  'member:read',
  'member:update',
  'member:remove',
  'role:read',
  'role:create',
  'invitation:read',
  'invitation:create',
  'audit-log:read',
  'conversation:read',
  'conversation:create',
  'grant:read',
]

/** 대리인 전용 권한입니다. */
const AGENT_ONLY: Permission[] = ['filing:process', 'subscription:manage', 'payment:retry', 'payment:refund']

/** 고객 업무 권한 표본입니다. 대리인이 고객 회사에서 그대로 처리합니다. */
const CLIENT_WORK: Permission[] = [
  'company:read',
  'company:update',
  'filing:read',
  'filing:update',
  'action-card:read',
  'employee:reveal-rrn',
  'organization:update',
  'payroll-ledger:approve',
  'payroll-workflow:update',
  'payslip:send',
  'evidence:classify',
  'report:read',
  'integration:create',
  'subscription:read',
  'payment:read',
]

describe('agent permission set (D5)', () => {
  it('lists client-work resources as wildcards and agent-only actions one by one', () => {
    expect([...AGENT_PERMISSIONS].sort()).toMatchInlineSnapshot(`
      [
        "account-title:*",
        "action-card:*",
        "bank-account:*",
        "bank-transaction:*",
        "billing-mandate:*",
        "business-status:*",
        "certificate-issuance:*",
        "certificate:*",
        "classification-rule:*",
        "company-document:*",
        "company-seal:*",
        "company:*",
        "consultation:*",
        "corporate-tax-filing:*",
        "document-form:*",
        "employee:*",
        "esign-request:*",
        "esign-template:*",
        "estimated-vat:*",
        "evidence:*",
        "external-service:*",
        "filing:*",
        "filing:process",
        "giro:*",
        "hometax-delegation:*",
        "income-tax-filing:*",
        "integration:*",
        "labor-cost-report:*",
        "messenger-channel:*",
        "organization:*",
        "partner:*",
        "payment:*",
        "payment:refund",
        "payment:retry",
        "payroll-calculator:*",
        "payroll-ledger:*",
        "payroll-rate-table:*",
        "payroll-setting:*",
        "payroll-workflow:*",
        "payslip:*",
        "realtime-report:*",
        "report:*",
        "salary-calculation:*",
        "sales-transaction:*",
        "scrap-request:*",
        "service-contract:*",
        "settlement-report:*",
        "severance-settlement:*",
        "subscription:*",
        "subscription:manage",
        "tax-invoice:*",
        "vat-filing:*",
        "withholding-tax-filing:*",
      ]
    `)
  })

  it.each(MEMBER_MANAGEMENT_AND_ASSISTANT)('does not give an agent %s by default', (permission) => {
    expect(hasPermission(agent, permission)).toBe(false)
  })

  it.each([...AGENT_ONLY, ...CLIENT_WORK])('gives an agent %s', (permission) => {
    expect(hasPermission(agent, permission)).toBe(true)
  })
})

describe('agent-only permissions', () => {
  it.each(AGENT_ONLY)('marks %s agent-only so no wildcard covers it', (permission) => {
    const resource = permissionResource(permission)

    expect(isAgentOnly(permission)).toBe(true)
    expect(hasPermission(admin, permission)).toBe(false)
    expect(hasPermission({ permissions: new Set<GrantedPermission>([`${resource}:*`]) }, permission)).toBe(false)
    expect(isGrantable(permission)).toBe(false)
  })

  it('still lets a role grant the rest of a resource that has an agent-only action', () => {
    expect(isGrantable('filing:read')).toBe(true)
    expect(isGrantable('subscription:*')).toBe(true)
    expect(hasPermission({ permissions: new Set<GrantedPermission>(['filing:*']) }, 'filing:submit')).toBe(true)
  })
})

describe('non-agent users', () => {
  it('keeps the admin wildcard, member management and the assistant included', () => {
    expect([...admin.permissions]).toEqual(['*'])
    for (const permission of [...MEMBER_MANAGEMENT_AND_ASSISTANT, ...CLIENT_WORK]) {
      expect(hasPermission(admin, permission)).toBe(true)
    }
  })

  it('keeps a member at the base permissions plus role permissions', () => {
    const member = actorPermissions({ kind: 'MEMBER', access: 'MEMBER', rolePermissions: [['employee:*']] })

    expect(hasPermission({ permissions: member }, 'conversation:create')).toBe(true)
    expect(hasPermission({ permissions: member }, 'employee:update')).toBe(true)
    expect(hasPermission({ permissions: member }, 'member:read')).toBe(false)
  })

  it('denies client admins agent commands as before', () => {
    expect(decideAccess(testActor(), { permission: 'subscription:manage' })?._tag).toBe('PermissionDenied')
    expect(decideAccess(testActor({ kind: 'AGENCY' }), { permission: 'subscription:manage' })).toBeUndefined()
  })
})

describe('both token scopes read the same table', () => {
  const layer = Layer.mergeAll(ActorDirectory.layer, AgentDirectory.layer).pipe(
    Layer.provideMerge(IdentityAccessMemoryLive),
    Layer.provide(CompanyPlans.layerMemory([[DEMO_COMPANY_IDS.corporation, ['TAXATION', 'PAYROLL']]])),
  )

  const resolveBoth = Effect.gen(function* () {
    const company = yield* (yield* ActorDirectory).resolve(DEMO_USER_IDS.agent, DEMO_COMPANY_IDS.corporation)
    const agency = yield* (yield* AgentDirectory).resolve(DEMO_USER_IDS.agent)
    return { actor: Option.getOrThrow(company).actor, agentScope: Option.getOrThrow(agency) }
  }).pipe(Effect.provide(layer))

  it('gives the company-scope agent actor and the agency-scope agent the same permissions', async () => {
    const { actor, agentScope } = await Effect.runPromise(resolveBoth)

    expect(actor.kind).toBe('AGENCY')
    expect([...actor.permissions].sort()).toEqual([...AGENT_PERMISSIONS].sort())
    expect([...agentScope.permissions].sort()).toEqual([...AGENT_PERMISSIONS].sort())
  })

  it.each([...MEMBER_MANAGEMENT_AND_ASSISTANT, ...AGENT_ONLY, ...CLIENT_WORK])(
    'decides %s the same way in authorize and authorizeAgency',
    async (permission) => {
      const { actor, agentScope } = await Effect.runPromise(resolveBoth)
      const companyAllowed = decideAccess(actor, { permission }) === undefined
      const agencyAllowed = await Effect.runPromise(
        authorizeAgency({ permission }).pipe(
          Effect.as(true),
          Effect.catchTag('PermissionDenied', () => Effect.succeed(false)),
          Effect.provideService(CurrentAgent, agentScope),
        ),
      )

      expect(agencyAllowed).toBe(companyAllowed)
    },
  )
})
