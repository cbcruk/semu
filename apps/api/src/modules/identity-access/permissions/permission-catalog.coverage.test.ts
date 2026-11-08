import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { grantablePermissions, PERMISSION_CATALOG } from './permission-catalog.ts'
import type { ResourcePermissions } from './permission-catalog.types.ts'

const SRC = join(import.meta.dirname, '../../..')

/** `resource:action` 모양의 문자열 리터럴입니다. `node:fs` 같은 모듈 지정자는 아래에서 뺍니다. */
const PERMISSION_LITERAL = /'([a-z][a-z-]*):([a-z][a-z-]*|\*)'/g

const NOT_PERMISSIONS = new Set(['node'])

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : []
  })
}

/** 테스트가 아닌 소스에 나오는 권한 문자열과 그 위치입니다. */
function usedPermissions(): Map<string, string> {
  const used = new Map<string, string>()
  for (const file of sourceFiles(SRC)) {
    for (const match of readFileSync(file, 'utf8').matchAll(PERMISSION_LITERAL)) {
      if (NOT_PERMISSIONS.has(match[1]!)) continue
      const permission = `${match[1]}:${match[2]}`
      if (!used.has(permission)) used.set(permission, relative(SRC, file))
    }
  }
  return used
}

function inCatalog(permission: string): boolean {
  const [resource, action] = permission.split(':') as [string, string]
  if (!Object.hasOwn(PERMISSION_CATALOG, resource)) return false
  const entry = (PERMISSION_CATALOG as Record<string, ResourcePermissions>)[resource]!
  return action === '*' || entry.actions.includes(action)
}

describe('권한 카탈로그가 덮는 범위', () => {
  it('소스에서 권한 문자열을 찾아냅니다', () => {
    expect(usedPermissions().size).toBeGreaterThan(100)
  })

  it('src에서 쓰는 권한 문자열을 모두 카탈로그에 올려 권한 그룹이 줄 수 있고 대리인이 받게 합니다', () => {
    const missing = [...usedPermissions()]
      .filter(([permission]) => !inCatalog(permission))
      .map(([permission, file]) => `${permission} (${file})`)

    expect(missing).toEqual([])
  })

  it('새로 올린 동작은 권한 그룹 화면에 내놓되 대리인 전용·관리자 전용 동작은 내놓지 않습니다', () => {
    const grantable = grantablePermissions().map((entry) => entry.permission)

    expect(grantable).toEqual(
      expect.arrayContaining(['employee:reveal-rrn', 'payroll-ledger:close', 'action-card:complete', 'filing:read']),
    )
    expect(grantable).not.toContain('filing:process')
    expect(grantable).not.toContain('subscription:manage')
    expect(grantable).not.toContain('member:update')
  })
})
