import type { Context, MiddlewareHandler } from 'hono'
import type { AppEnv } from '../../app.types'
import { DomainError } from '../../lib/domain-error'
import { assertAllowed } from '../../middleware/access'
import { decide } from '../access/access'
import type { MenuCode } from '../access/access.types'

/** Rejects the request unless the user may open at least one of the menus; the first menu's denial is reported. */
export function requireAnyMenu(codes: readonly [MenuCode, ...MenuCode[]]): MiddlewareHandler<AppEnv> {
  return async (c, next): Promise<void> => {
    const decisions = codes.map((code) => decide(c.var.access, code))
    if (!decisions.some((decision) => decision.ok)) assertAllowed(decisions[0] ?? { ok: true })
    await next()
  }
}

/** Rejects users who are not admins of the company; assigned agency staff count as admins. */
export function requireCompanyAdmin(): MiddlewareHandler<AppEnv> {
  return async (c, next): Promise<void> => {
    if (!c.var.access.isAdmin) throw new DomainError('PERMISSION_DENIED', 'Only company admins can do this.')
    await next()
  }
}

/** Rejects callers who are not tax agency staff assigned to the company. */
export function requireAgencyActor(): MiddlewareHandler<AppEnv> {
  return async (c, next): Promise<void> => {
    if (c.var.access.actor !== 'agency') throw new DomainError('PERMISSION_DENIED', 'Agency staff only.')
    await next()
  }
}

/** Reads the client details recorded with sessions and agreements. */
export function clientOf(c: Context): { ip: string | null; userAgent: string | null } {
  return {
    ip: c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ?? null,
    userAgent: c.req.header('User-Agent') ?? null,
  }
}
