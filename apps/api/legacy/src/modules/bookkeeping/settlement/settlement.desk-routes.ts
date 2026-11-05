import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import type { AppDeps, AppEnv, AuthUser } from '../../../app.types'
import { transaction } from '../../../db/query'
import { invalidField, notFound } from '../../../lib/domain-error'
import { assignedCompanyIds, requireAgency } from '../../../middleware/agency-scope'
import { toValidationError, validationHook } from '../../../middleware/validation'
import { findClosing } from './settlement.repository'
import { arApUpload, bsUpload, cashUpload, plUpload, uploadParam } from './settlement.schema'
import { replaceSettlementSnapshot } from './settlement.service'
import type { SettlementClosingRow, SettlementScope, SnapshotUpload } from './settlement.types'

/**
 * Agency routes that upload settlement snapshots under `/api/desk/companies/:companyId`.
 *
 * `PUT …/settlements/:year/:scope` replaces the whole scope for the fiscal
 * year ("보고서 업데이트"). Only agency staff assigned to the company may
 * call it; other companies answer 404.
 */
export function settlementDeskRoutes(deps: AppDeps): Hono<AppEnv> {
  const params = zValidator('param', uploadParam, validationHook)
  const assertAssigned = (user: AuthUser, companyId: string): void => {
    if (!assignedCompanyIds(deps.db, user).includes(companyId)) throw notFound('Company')
  }
  const respond = (closing: SettlementClosingRow): Record<string, unknown> => ({
    fiscal_year: closing.fiscal_year,
    scope: closing.scope,
    closed_through: closing.closed_through,
    updated_at: closing.updated_at,
    updated_by: closing.updated_by,
  })

  return new Hono<AppEnv>()
    .use('/api/desk/companies/*', requireAgency())
    .get('/api/desk/companies/:companyId/settlements/:year/:scope', params, (c) => {
      const { companyId, year, scope } = c.req.valid('param')
      assertAssigned(c.var.user, companyId)
      const closing = findClosing(deps.db, companyId, year, scope)
      if (closing === undefined) throw notFound('Settlement snapshot')
      return c.json(respond(closing))
    })
    .put('/api/desk/companies/:companyId/settlements/:year/:scope', params, async (c) => {
      const { companyId, year, scope } = c.req.valid('param')
      assertAssigned(c.var.user, companyId)
      const body: unknown = await c.req.json().catch(() => {
        throw invalidField('non_field_errors', 'Send a JSON body.')
      })
      const upload = parseUpload(scope, body)
      const closing = transaction(deps.db, () =>
        replaceSettlementSnapshot(deps.db, companyId, year, upload, { userId: c.var.user.id, now: deps.clock.now() }),
      )
      return c.json(respond(closing))
    })
}

function parseUpload(scope: SettlementScope, body: unknown): SnapshotUpload {
  switch (scope) {
    case 'pl': {
      const parsed = plUpload.safeParse(body)
      if (!parsed.success) throw toValidationError(parsed.error.issues)
      return { scope, ...parsed.data }
    }
    case 'bs': {
      const parsed = bsUpload.safeParse(body)
      if (!parsed.success) throw toValidationError(parsed.error.issues)
      return { scope, ...parsed.data }
    }
    case 'cash': {
      const parsed = cashUpload.safeParse(body)
      if (!parsed.success) throw toValidationError(parsed.error.issues)
      return { scope, ...parsed.data }
    }
    case 'ar_ap': {
      const parsed = arApUpload.safeParse(body)
      if (!parsed.success) throw toValidationError(parsed.error.issues)
      return { scope, ...parsed.data }
    }
  }
}
