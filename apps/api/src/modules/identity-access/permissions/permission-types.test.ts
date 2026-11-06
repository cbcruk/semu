import { describe, expect, expectTypeOf, it } from 'vitest'
import { hasPermission } from '../actor.ts'
import type { AccessRequirement } from '../authorization.ts'
import { isGrantedPermission } from './permission-catalog.ts'
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
})
