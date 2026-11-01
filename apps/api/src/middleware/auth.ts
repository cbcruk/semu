import type { MiddlewareHandler } from 'hono'
import { verify } from 'hono/jwt'
import type { AppDeps, AppEnv } from '../app.types'
import { queryOne } from '../db/query'
import { DomainError } from '../lib/domain-error'
import type { UserType } from '../modules/access/access.types'

/**
 * Verifies the company-scoped HS256 JWT issued by nexus and loads the user.
 *
 * Expects `sub` (user ID) and, for customer tokens, `company_id`.
 */
export function authenticate(deps: Pick<AppDeps, 'db' | 'jwtSecret'>): MiddlewareHandler<AppEnv> {
  return async (c, next): Promise<void> => {
    const header = c.req.header('Authorization')
    if (header === undefined || !header.startsWith('Bearer ')) throw unauthenticated()
    let payload: Record<string, unknown>
    try {
      payload = await verify(header.slice('Bearer '.length), deps.jwtSecret, 'HS256')
    } catch {
      throw unauthenticated()
    }
    const subject = payload['sub']
    if (typeof subject !== 'string') throw unauthenticated()
    const user = queryOne<{ id: string; user_type: UserType }>(deps.db, 'SELECT id, user_type FROM users WHERE id = ?', [subject])
    if (user === undefined) throw unauthenticated()
    const companyId = payload['company_id']
    c.set('user', { id: user.id, userType: user.user_type })
    c.set('tokenCompanyId', typeof companyId === 'string' || typeof companyId === 'number' ? String(companyId) : null)
    await next()
  }
}

function unauthenticated(): DomainError {
  return new DomainError('UNAUTHENTICATED', 'Authentication credentials were not provided or are invalid.')
}
