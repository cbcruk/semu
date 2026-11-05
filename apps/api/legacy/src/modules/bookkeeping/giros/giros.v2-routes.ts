import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import type { AppDeps, AppEnv } from '../../../app.types'
import { requireMenu } from '../../../middleware/access'
import { companyScope } from '../../../middleware/company-scope'
import { validationHook } from '../../../middleware/validation'
import { payGiroBody } from './giros.schema'
import { payGiro } from './giros.service'

/**
 * Giro payment routes under `/api/v2/company/:companyId`, mounted at the root after authentication.
 *
 * The v2 prefix sits outside the company router, so the company scope check
 * is applied here, limited to the v2 company paths.
 */
export function giroV2Routes(deps: AppDeps): Hono<AppEnv> {
  return new Hono<AppEnv>()
    .use('/api/v2/company/:companyId/*', companyScope(deps))
    .post(
      '/api/v2/company/:companyId/giros/:id/payment',
      requireMenu('bookkeeping_tax_payment'),
      zValidator('json', payGiroBody, validationHook),
      async (c) => {
        const body = c.req.valid('json')
        const result = await payGiro(deps, c.var.company.id, c.req.param('id'), c.var.user.id, {
          paymentAccountId: body.payment_account_id,
          bankCode: body.bank_code,
          accountNumber: body.account_number,
          accountPassword: body.account_password,
          amount: body.amount,
          requestId: body.request_id,
        })
        return c.json(result)
      },
    )
}
