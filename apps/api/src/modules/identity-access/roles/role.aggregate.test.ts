import { Result } from 'effect'
import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { Membership } from '../members/membership.ts'
import { testActor } from '../testing.ts'
import { decideRoleCreation, decideRoleRemoval, decideRoleUpdate } from './role.aggregate.ts'
import type { RoleRecord } from './role.ts'

const actor = testActor()
const role: RoleRecord = {
  id: 'rol_01JBQ000000000000000000001' as Id<'role'>,
  companyId: actor.companyId,
  name: '인사 담당',
  permissions: ['employee:read'],
  templateCode: 'HR',
  createdAt: '2026-11-01T00:00:00.000Z',
  version: 2,
}
const other: RoleRecord = { ...role, id: 'rol_01JBQ000000000000000000002' as Id<'role'>, name: '급여 담당' }
const holder: Membership = {
  id: 'mbr_01JBQ000000000000000000001' as Id<'membership'>,
  companyId: actor.companyId,
  userId: 'usr_01JBQ000000000000000000009' as Id<'user'>,
  access: 'MEMBER',
  roleIds: [role.id, other.id],
  isOwner: false,
  joinedAt: '2026-11-01T00:00:00.000Z',
  version: 4,
}

describe('decideRoleCreation', () => {
  it('이름을 다듬고 권한을 겹침 없이 정렬해 만들며 생성 감사 기록을 남깁니다', () => {
    const decision = Result.getOrThrow(
      decideRoleCreation(
        { id: 'rol_01JBQ000000000000000000003' as Id<'role'>, createdAt: '2026-11-15T00:00:00.000Z' },
        { name: ' 회계 ', permissions: ['employee:read', 'employee:create', 'employee:read'] },
        [role],
        actor,
      ),
    )

    expect(decision.role).toMatchObject({ name: '회계', permissions: ['employee:create', 'employee:read'], version: 1 })
    expect(decision.role).not.toHaveProperty('templateCode')
    expect(decision.audit).toEqual([
      expect.objectContaining({ action: 'ROLE_CREATED', targetId: 'rol_01JBQ000000000000000000003' }),
    ])
  })

  it('줄 수 없는 권한은 이름이 겹쳐도 먼저 알려 줍니다', () => {
    const result = decideRoleCreation(
      { id: 'rol_01JBQ000000000000000000003' as Id<'role'>, createdAt: '' },
      { name: '인사 담당', permissions: ['filing:process'] },
      [role],
      actor,
    )

    expect(Result.isFailure(result) && result.failure).toMatchObject({
      _tag: 'PermissionNotGrantable',
      permissions: ['filing:process'],
    })
  })
})

describe('decideRoleUpdate', () => {
  it('자기 이름은 그대로 둘 수 있지만 다른 그룹 이름과 겹치면 거부합니다', () => {
    const same = decideRoleUpdate(role, { name: '인사 담당', permissions: ['employee:read'] }, [role, other], [], actor)
    const taken = decideRoleUpdate(
      role,
      { name: '급여 담당', permissions: ['employee:read'] },
      [role, other],
      [],
      actor,
    )

    expect(Result.isSuccess(same)).toBe(true)
    expect(Result.isFailure(taken) && taken.failure._tag).toBe('RoleNameTaken')
  })

  it('보내지 않은 템플릿 코드는 지우고, 그룹을 가진 사용자의 access token을 폐기합니다', () => {
    const decision = Result.getOrThrow(
      decideRoleUpdate(role, { name: '인사', permissions: ['employee:read'] }, [role], [holder], actor),
    )

    expect(decision.role).toMatchObject({ name: '인사', version: 3 })
    expect(decision.role).not.toHaveProperty('templateCode')
    expect(decision.invalidatedUserIds).toEqual([holder.userId])
  })
})

describe('decideRoleRemoval', () => {
  it('구성원에게서 그 그룹만 떼고 버전을 올리며 access token을 폐기합니다', () => {
    const decision = decideRoleRemoval(role, [holder], actor)

    expect(decision.memberships).toEqual([{ ...holder, roleIds: [other.id], version: 5 }])
    expect(decision.invalidatedUserIds).toEqual([holder.userId])
    expect(decision.audit).toEqual([expect.objectContaining({ action: 'ROLE_DELETED', targetId: role.id })])
  })
})
