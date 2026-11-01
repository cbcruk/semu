import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../app.types'
import { DomainError, notFound } from '../lib/domain-error'
import { decide } from '../modules/access/access'
import type { AccessDecision, MenuCode } from '../modules/access/access.types'
import { TAX_TYPE_MENU_CODE, taxTypeFromPathSegment } from '../modules/access/menu-codes'

/** Rejects the request unless the user may open a menu, using the same rules as the menu tree. */
export function requireMenu(code: MenuCode): MiddlewareHandler<AppEnv> {
  return async (c, next): Promise<void> => {
    assertAllowed(decide(c.var.access, code))
    await next()
  }
}

/** Resolves the `:taxType` path segment and requires access to its menu. */
export function requireTaxMenu(): MiddlewareHandler<AppEnv> {
  return async (c, next): Promise<void> => {
    const taxType = taxTypeFromPathSegment(c.req.param('taxType') ?? '')
    if (taxType === undefined) throw notFound('Tax type')
    assertAllowed(decide(c.var.access, TAX_TYPE_MENU_CODE[taxType]))
    c.set('taxType', taxType)
    await next()
  }
}

/**
 * Converts a denied decision into the matching error.
 *
 * @throws {DomainError} With the denial reason as its code.
 */
export function assertAllowed(decision: AccessDecision): void {
  if (decision.ok) return
  switch (decision.reason) {
    case 'NOT_FOUND':
      throw notFound('Menu')
    case 'PERMISSION_DENIED':
      throw new DomainError('PERMISSION_DENIED', 'You do not have access to this menu.')
    case 'ENTITLEMENT_REQUIRED':
      throw new DomainError('ENTITLEMENT_REQUIRED', 'This menu requires a tax bookkeeping plan.', {
        promotion_url: decision.promotionUrl,
      })
    case 'TAX_TERMS_REQUIRED':
      throw new DomainError('TAX_TERMS_REQUIRED', 'Agree to the tax service terms to continue.')
  }
}
