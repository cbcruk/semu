import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../../../app.types'
import { assertAllowed } from '../../../middleware/access'
import { decide } from '../../access/access'
import type { MenuCode } from '../../access/access.types'

/**
 * Allows the request when the user may open any one of the menus.
 *
 * Shared lookups such as departments or templates are read from several
 * screens, so they accept any of those screens' menus. When every menu is
 * denied, the first menu's denial decides the error.
 */
export function requireAnyMenu(codes: readonly [MenuCode, ...MenuCode[]]): MiddlewareHandler<AppEnv> {
  return async (c, next): Promise<void> => {
    const decisions = codes.map((code) => decide(c.var.access, code))
    const allowed = decisions.find((decision) => decision.ok)
    assertAllowed(allowed ?? decisions[0] ?? { ok: false, reason: 'NOT_FOUND', promotionUrl: null })
    await next()
  }
}
