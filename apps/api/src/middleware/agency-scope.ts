import type { MiddlewareHandler } from 'hono'
import type { DatabaseSync } from 'node:sqlite'
import type { AppEnv, AuthUser } from '../app.types'
import { queryAll } from '../db/query'
import { DomainError } from '../lib/domain-error'
import { isAgencyUser, USER_TYPE } from '../modules/access/user-type'

/** Rejects users who are not tax agency members or managers. */
export function requireAgency(): MiddlewareHandler<AppEnv> {
  return async (c, next): Promise<void> => {
    if (!isAgencyUser(c.var.user.userType)) throw new DomainError('PERMISSION_DENIED', 'Agency staff only.')
    await next()
  }
}

/** Lists the companies an agency user handles; managers also see their team members' companies. */
export function assignedCompanyIds(db: DatabaseSync, user: AuthUser): string[] {
  const rows =
    user.userType === USER_TYPE.agencyManager
      ? queryAll<{ company_id: string }>(
          db,
          `SELECT DISTINCT company_id FROM agency_assignments
           WHERE user_id = ? OR user_id IN (SELECT id FROM users WHERE manager_id = ?) ORDER BY company_id`,
          [user.id, user.id],
        )
      : queryAll<{ company_id: string }>(db, 'SELECT company_id FROM agency_assignments WHERE user_id = ? ORDER BY company_id', [user.id])
  return rows.map((row) => row.company_id)
}
