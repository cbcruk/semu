import type { MiddlewareHandler } from 'hono'
import type { AppDeps, AppEnv } from '../app.types'
import { DomainError, notFound } from '../lib/domain-error'
import { loadAccessContext } from '../modules/access/access-directory'
import { isAgencyUser, USER_TYPE } from '../modules/access/user-type'
import { findCompany } from '../modules/companies/companies.repository'

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Binds a customer request to the company in its path.
 *
 * Rejects tokens issued for another company, users who neither belong to it
 * nor are agency staff assigned to it, and writes from demo accounts, then
 * stores the company and the user's access context. Agency tokens carry no
 * `company_id`, so they pass the token check and rely on the assignment.
 */
export function companyScope(deps: Pick<AppDeps, 'db' | 'taxTermsVersion'>): MiddlewareHandler<AppEnv> {
  return async (c, next): Promise<void> => {
    const companyId = c.req.param('companyId')
    if (companyId === undefined) throw notFound('Company')
    if (c.var.tokenCompanyId !== companyId && !(c.var.tokenCompanyId === null && isAgencyUser(c.var.user.userType))) {
      throw new DomainError('COMPANY_MISMATCH', 'The token was issued for a different company.')
    }
    const company = findCompany(deps.db, companyId)
    if (company === undefined) throw notFound('Company')
    const access = loadAccessContext(deps.db, c.var.user, company, deps.taxTermsVersion)
    if (access === null) throw new DomainError('PERMISSION_DENIED', 'You are not a member of this company.')
    if (c.var.user.userType === USER_TYPE.demoClient && !READ_METHODS.has(c.req.method)) {
      throw new DomainError('DEMO_READ_ONLY', 'Demo accounts cannot change data.')
    }
    c.set('company', company)
    c.set('access', access)
    await next()
  }
}
