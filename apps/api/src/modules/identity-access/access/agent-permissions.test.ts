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

describe('세무 대리인의 권한 집합 (D5)', () => {
  it('고객 업무 리소스는 와일드카드로, 대리인 전용 동작은 하나씩 적습니다', () => {
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
        "earner:*",
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

  it.each(MEMBER_MANAGEMENT_AND_ASSISTANT)('대리인에게 %s 권한을 기본으로 주지 않습니다', (permission) => {
    expect(hasPermission(agent, permission)).toBe(false)
  })

  it.each([...AGENT_ONLY, ...CLIENT_WORK])('대리인에게 %s 권한을 줍니다', (permission) => {
    expect(hasPermission(agent, permission)).toBe(true)
  })
})

describe('대리인 전용 권한', () => {
  it.each(AGENT_ONLY)('%s는 대리인 전용이라 어떤 와일드카드로도 덮이지 않습니다', (permission) => {
    const resource = permissionResource(permission)

    expect(isAgentOnly(permission)).toBe(true)
    expect(hasPermission(admin, permission)).toBe(false)
    expect(hasPermission({ permissions: new Set<GrantedPermission>([`${resource}:*`]) }, permission)).toBe(false)
    expect(isGrantable(permission)).toBe(false)
  })

  it('대리인 전용 동작이 있는 리소스라도 나머지 동작은 권한 그룹으로 줄 수 있습니다', () => {
    expect(isGrantable('filing:read')).toBe(true)
    expect(isGrantable('subscription:*')).toBe(true)
    expect(hasPermission({ permissions: new Set<GrantedPermission>(['filing:*']) }, 'filing:submit')).toBe(true)
  })
})

describe('대리인이 아닌 사용자', () => {
  it('관리자는 와일드카드로 구성원 관리와 AI 비서를 그대로 가집니다', () => {
    expect([...admin.permissions]).toEqual(['*'])
    for (const permission of [...MEMBER_MANAGEMENT_AND_ASSISTANT, ...CLIENT_WORK]) {
      expect(hasPermission(admin, permission)).toBe(true)
    }
  })

  it('일반 구성원은 기본 권한과 권한 그룹 권한만 가집니다', () => {
    const member = actorPermissions({ kind: 'MEMBER', access: 'MEMBER', rolePermissions: [['employee:*']] })

    expect(hasPermission({ permissions: member }, 'conversation:create')).toBe(true)
    expect(hasPermission({ permissions: member }, 'employee:update')).toBe(true)
    expect(hasPermission({ permissions: member }, 'member:read')).toBe(false)
  })

  it('고객 관리자에게는 전처럼 대리인 전용 동작을 허용하지 않습니다', () => {
    expect(decideAccess(testActor(), { permission: 'subscription:manage' })?._tag).toBe('PermissionDenied')
    expect(decideAccess(testActor({ kind: 'AGENCY' }), { permission: 'subscription:manage' })).toBeUndefined()
  })
})

describe('두 토큰 범위가 같은 권한 표를 봄', () => {
  const layer = Layer.mergeAll(ActorDirectory.layer, AgentDirectory.layer).pipe(
    Layer.provideMerge(IdentityAccessMemoryLive),
    Layer.provide(CompanyPlans.layerMemory([[DEMO_COMPANY_IDS.corporation, ['TAXATION', 'PAYROLL']]])),
  )

  const resolveBoth = Effect.gen(function* () {
    const company = yield* (yield* ActorDirectory).resolve(DEMO_USER_IDS.agent, DEMO_COMPANY_IDS.corporation)
    const agency = yield* (yield* AgentDirectory).resolve(DEMO_USER_IDS.agent)
    return { actor: Option.getOrThrow(company).actor, agentScope: Option.getOrThrow(agency) }
  }).pipe(Effect.provide(layer))

  it('회사 범위 대리인 행위자와 대리인 범위 대리인에게 같은 권한을 줍니다', async () => {
    const { actor, agentScope } = await Effect.runPromise(resolveBoth)

    expect(actor.kind).toBe('AGENCY')
    expect([...actor.permissions].sort()).toEqual([...AGENT_PERMISSIONS].sort())
    expect([...agentScope.permissions].sort()).toEqual([...AGENT_PERMISSIONS].sort())
  })

  it.each([...MEMBER_MANAGEMENT_AND_ASSISTANT, ...AGENT_ONLY, ...CLIENT_WORK])(
    '%s 권한을 authorize와 authorizeAgency가 같게 판정합니다',
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
