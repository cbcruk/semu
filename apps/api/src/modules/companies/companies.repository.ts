import type { DatabaseSync } from 'node:sqlite'
import { queryAll, queryOne } from '../../db/query'
import type { CompanyRow } from './companies.types'

/** Finds a company by its ID. */
export function findCompany(db: DatabaseSync, companyId: string): CompanyRow | undefined {
  return queryOne<CompanyRow>(db, 'SELECT * FROM companies WHERE id = ?', [companyId])
}

/** Lists every company, for batch jobs. */
export function listCompanies(db: DatabaseSync): CompanyRow[] {
  return queryAll<CompanyRow>(db, 'SELECT * FROM companies ORDER BY id')
}
