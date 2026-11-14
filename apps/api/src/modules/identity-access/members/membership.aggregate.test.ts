import { Result } from 'effect'
import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { testActor } from '../testing.ts'
import { decideMemberAccessChange, decideMemberRemoval } from './membership.aggregate.ts'
import type { Membership } from './membership.ts'

const actor = testActor()
const ROLE = 'rol_01JBQ000000000000000000001' as Id<'role'>
const admin: Membership = {
  id: 'mbr_01JBQ000000000000000000001' as Id<'membership'>,
  companyId: actor.companyId,
  userId: 'usr_01JBQ000000000000000000009' as Id<'user'>,
  access: 'ADMIN',
  roleIds: [],
  isOwner: false,
  joinedAt: '2026-11-01T00:00:00.000Z',
  version: 2,
}
const roles = new Set<string>([ROLE])

describe('decideMemberAccessChange', () => {
  it('구성원으로 바꾸면 그룹을 겹침 없이 담고 버전을 올리며 접근과 그룹을 감사 기록에 남깁니다', () => {
    const decision = Result.getOrThrow(
      decideMemberAccessChange(
        admin,
        { access: 'MEMBER', roleIds: [ROLE, ROLE] },
        { otherAdminCount: 1, companyRoleIds: roles },
        actor,
      ),
    )

    expect(decision.membership).toMatchObject({ access: 'MEMBER', roleIds: [ROLE], version: 3 })
    expect(decision.audit).toEqual([
      expect.objectContaining({ action: 'MEMBER_ACCESS_CHANGED', targetId: admin.userId, detail: `MEMBER:${ROLE}` }),
    ])
  })

  it('소유자는 관리자에서 내릴 수 없고 마지막 관리자도 내릴 수 없습니다', () => {
    const owner = decideMemberAccessChange(
      { ...admin, isOwner: true },
      { access: 'MEMBER', roleIds: [] },
      { otherAdminCount: 0, companyRoleIds: roles },
      actor,
    )
    const last = decideMemberAccessChange(
      admin,
      { access: 'MEMBER', roleIds: [] },
      { otherAdminCount: 0, companyRoleIds: roles },
      actor,
    )

    expect(Result.isFailure(owner) && owner.failure._tag).toBe('OwnerImmutable')
    expect(Result.isFailure(last) && last.failure._tag).toBe('LastAdmin')
  })

  it('없는 그룹이면 거부하고, 관리자로 바꾸면 그룹을 두지 않습니다', () => {
    const member = { ...admin, access: 'MEMBER' as const }
    const missing = decideMemberAccessChange(
      member,
      { access: 'MEMBER', roleIds: ['rol_01JBQ000000000000000000002' as Id<'role'>] },
      { otherAdminCount: 1, companyRoleIds: roles },
      actor,
    )
    const promoted = decideMemberAccessChange(
      member,
      { access: 'ADMIN', roleIds: [ROLE] },
      { otherAdminCount: 0, companyRoleIds: roles },
      actor,
    )

    expect(Result.isFailure(missing) && missing.failure._tag).toBe('RoleNotFound')
    expect(Result.getOrThrow(promoted).membership).toMatchObject({ access: 'ADMIN', roleIds: [] })
  })
})

describe('decideMemberRemoval', () => {
  it('소유자와 마지막 관리자는 내보낼 수 없고, 아니면 내보내기 감사 기록을 남깁니다', () => {
    const owner = decideMemberRemoval({ ...admin, isOwner: true }, 3, actor)
    const last = decideMemberRemoval(admin, 0, actor)

    expect(Result.isFailure(owner) && owner.failure._tag).toBe('OwnerImmutable')
    expect(Result.isFailure(last) && last.failure._tag).toBe('LastAdmin')
    expect(Result.getOrThrow(decideMemberRemoval(admin, 1, actor)).audit).toEqual([
      expect.objectContaining({ action: 'MEMBER_REMOVED', targetId: admin.userId }),
    ])
  })
})
