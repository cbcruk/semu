import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../../../app.types'
import { validationHook } from '../../../middleware/validation'
import { queryAll } from '../../../db/query'
import { parsePageRequest, toPage } from '../../../lib/drf-pagination'
import type { CompanyRow } from '../../companies/companies.types'
import { findWorkContractAsOf } from '../contracts/contracts.repository'
import { listEmployeeViews } from '../employees/employees.repository'
import { maskedRegistrationNumber } from '../employees/employees.serializer'
import type { EmployeeView } from '../employees/employees.types'
import { listFamilyMembers } from '../family/family.repository'
import { listAllLeaves } from '../leaves/leaves.repository'
import { LEAVING_REASONS } from '../retirement/leaving-reasons'
import { findRetirementInfo } from '../retirement/retirement.repository'
import { requireAnyMenu } from '../shared/hr-access'
import type { HrContext } from '../shared/hr-context.types'
import { fromFlag } from '../shared/hr.utils'
import type { InsuranceFilingKind, InsuranceFilingRow } from '../shared/insurance-filings.repository'
import { legacyEmploymentStatus } from './legacy.utils'

const legacyQuery = z.object({
  simple: z.enum(['True', 'False', 'true', 'false']).optional(),
  search: z.string().trim().max(100).optional(),
  limit: z.string().optional(),
  offset: z.string().optional(),
})

const FILING_KINDS: readonly InsuranceFilingKind[] = ['join', 'leave', 'dependent', 'leave_of_absence', 'reinstatement']

/**
 * Routes of the legacy 직원 관리 screen used by bookkeeping customers.
 *
 * The response follows the demo mock's `Employee` shape with the Korean
 * `employment_status`; `simple=True` returns the short form.
 */
export function legacyEmployeeRoutes({ deps }: HrContext): Hono<AppEnv> {
  const menu = requireAnyMenu(['employee_management', 'employment_employee'])

  return new Hono<AppEnv>()
    .get('/employee', menu, zValidator('query', legacyQuery, validationHook), (c) => {
      const query = c.req.valid('query')
      const page = parsePageRequest(query.limit, query.offset)
      const today = deps.clock.today()
      const filter = { statuses: [], search: query.search ?? null, dateType: null, startDate: null, endDate: null, contractFilter: null, ordering: null }
      const { rows, count } = listEmployeeViews(deps.db, c.var.company.id, 'wage-salary', filter, today, page)
      const filings = pendingFilings(c.var.company.id, rows.map((row) => row.id))
      const simple = query.simple?.toLowerCase() === 'true'
      const results = rows.map((view) => {
        const pending = new Set(filings.filter((filing) => filing.employee_id === view.id).map((filing) => filing.kind))
        const short = {
          id: view.id,
          company: c.var.company.id,
          name: view.name,
          employment_status: legacyEmploymentStatus(view, pending),
          join_date: view.join_date,
          leave_date: view.leave_date,
          registration_number: maskedRegistrationNumber(view, deps.cipher),
          kind: view.kind,
          email: view.email,
        }
        if (simple) return short
        return { ...short, ...fullFields(c.var.company, view, filings.filter((filing) => filing.employee_id === view.id)) }
      })
      return c.json(toPage(results, count, page, c.req.url))
    })
    .get('/employee/leaving-reason', menu, (c) =>
      c.json(
        LEAVING_REASONS.map((reason) => ({
          code: reason.code,
          name: reason.name,
          children: reason.details.map((detail) => ({ code: detail.code, name: detail.name })),
        })),
      ),
    )

  function pendingFilings(companyId: string, employeeIds: readonly number[]): InsuranceFilingRow[] {
    if (employeeIds.length === 0) return []
    return queryAll<InsuranceFilingRow>(
      deps.db,
      `SELECT * FROM employee_insurance_filings WHERE company_id = ? AND status = 'pending' AND employee_id IN (${employeeIds.map(() => '?').join(', ')})`,
      [companyId, ...employeeIds],
    )
  }

  function fullFields(company: CompanyRow, view: EmployeeView, filings: readonly InsuranceFilingRow[]): Record<string, unknown> {
    const today = deps.clock.today()
    const contract = findWorkContractAsOf(deps.db, view.company_id, view.id, today)
    const retirement = findRetirementInfo(deps.db, view.company_id, view.id)
    const family = listFamilyMembers(deps.db, view.company_id, view.id)
    const work: Record<string, unknown> = {}
    for (const kind of FILING_KINDS) {
      const filing = filings.find((candidate) => candidate.kind === kind)
      work[`is_${kind}_work`] = filing !== undefined
      work[`${kind}_work_time`] = filing?.requested_at ?? null
    }
    return {
      company: {
        id: company.id,
        name: company.name,
        kind: { value: company.business_type, display: company.business_type === 'corporate' ? '법인' : '개인' },
        is_corporation_tax: company.business_type === 'corporate',
        business_number: company.business_number,
      },
      duzon_code: view.employee_number,
      is_contract_worker: view.contract_type === 'contract',
      contract_end_date: view.contract_end_date,
      weekly_work_time: contract?.weekly_work_hours ?? null,
      work_code: view.work_code,
      is_rejoin: fromFlag(view.is_rejoin),
      leave_of_absence: listAllLeaves(deps.db, view.company_id, view.id).map((leave) => ({
        id: leave.id,
        reason: leave.reason,
        start_date: leave.start_date,
        end_date: leave.end_date,
        actual_return_date: leave.actual_return_date,
      })),
      retirement_reason: retirement?.leaving_reason ?? null,
      retirement_detail_reason: retirement?.leaving_detail_reason ?? null,
      retirement_pension_type: retirement?.retirement_benefit_type ?? null,
      retirement_grants: retirement?.severance_amount ?? null,
      paid_retirement_grants: retirement?.severance_settlement_status === 'completed',
      is_interim_retirement_grants: retirement === undefined ? false : fromFlag(retirement.has_interim_settlement),
      family: family.map((member) => ({ id: member.id, name: member.name, relation: member.relation })),
      family_count: family.length,
      is_temp_save: view.registration_number_enc === null,
      employee_work: work,
    }
  }
}
