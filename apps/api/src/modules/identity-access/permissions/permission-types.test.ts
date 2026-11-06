import { describe, expect, expectTypeOf, it } from 'vitest'
import { actorPermissions } from '../access/actor-permissions.ts'
import { hasPermission } from '../actor.ts'
import type { AccessRequirement } from '../authorization.ts'
import { isGrantable, isGrantedPermission, LEGACY_MENU_PERMISSIONS, ROLE_TEMPLATES } from './permission-catalog.ts'
import type { GrantedPermission, Permission, PermissionWildcard } from './permission-catalog.ts'

/**
 * 권한 타입이 카탈로그에서 만든 리터럴 유니온인지 확인합니다. `@ts-expect-error` 줄은 `tsc --noEmit`이 검사합니다.
 * 오류가 나지 않으면(오타가 컴파일되면) `tsc`가 "쓰이지 않은 @ts-expect-error"로 실패합니다.
 */
describe('permission types', () => {
  it('accepts catalog permissions and rejects unknown ones at compile time', () => {
    const ok: Permission = 'employee:read'
    // @ts-expect-error 카탈로그에 없는 동작(오타)
    const typo: Permission = 'employee:raed'
    // @ts-expect-error 카탈로그에 없는 리소스
    const unknown: Permission = 'probe:read'
    // @ts-expect-error 요구 권한에는 와일드카드가 들지 않습니다
    const wildcard: Permission = 'employee:*'

    expect([ok, typo, unknown, wildcard]).toHaveLength(4)
  })

  it('rejects an unknown permission where an API takes one', () => {
    // @ts-expect-error authorize의 요구 권한은 카탈로그 권한이어야 합니다
    const requirement: AccessRequirement = { permission: 'hr.employees.write' }
    // @ts-expect-error hasPermission도 같습니다
    const held = hasPermission({ permissions: new Set(['*']) }, 'employee:raed')

    expect([requirement, held]).toHaveLength(2)
  })

  it('keeps wildcards as a separate type that actors may hold', () => {
    expectTypeOf<'*'>().toExtend<PermissionWildcard>()
    expectTypeOf<'employee:*'>().toExtend<GrantedPermission>()
    expectTypeOf<'employee:read'>().toExtend<GrantedPermission>()
    expectTypeOf<'employee:raed'>().not.toExtend<GrantedPermission>()
  })

  it('narrows stored strings with the same catalog at runtime', () => {
    expect(isGrantedPermission('employee:*')).toBe(true)
    expect(isGrantedPermission('filing:process')).toBe(true)
    expect(isGrantedPermission('*')).toBe(true)
    expect(isGrantedPermission('employee:raed')).toBe(false)
    expect(isGrantedPermission('hr.employees.write')).toBe(false)
  })

  it('drops stored role permissions that a role could not grant', () => {
    const refused = ['employee:raed', '*', 'member:*', 'member:remove', 'filing:process']
    const permissions = actorPermissions({
      kind: 'MEMBER',
      access: 'MEMBER',
      rolePermissions: [['employee:*', ...refused]],
    })

    expect(permissions.has('employee:*')).toBe(true)
    expect([...permissions].filter((permission) => refused.includes(permission))).toEqual([])
  })

  it('keeps the admin wildcard and agent permissions, which do not come from stored roles', () => {
    expect(actorPermissions({ kind: 'MEMBER', access: 'ADMIN', rolePermissions: [] }).has('*')).toBe(true)
    expect(actorPermissions({ kind: 'AGENCY' }).has('filing:process')).toBe(true)
  })

  it('keeps every role template and legacy menu permission when stored in a role', () => {
    const stored = [
      ...ROLE_TEMPLATES.flatMap((template) => template.permissions),
      ...Object.values(LEGACY_MENU_PERMISSIONS).flatMap((mapping) => mapping.permissions),
    ]
    const permissions = actorPermissions({ kind: 'MEMBER', access: 'MEMBER', rolePermissions: [stored] })

    expect(stored.filter((permission) => !isGrantable(permission))).toEqual([])
    expect(stored.filter((permission) => !permissions.has(permission))).toEqual([])
  })
})
