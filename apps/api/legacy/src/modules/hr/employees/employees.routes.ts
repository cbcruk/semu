import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import type { z } from 'zod'
import type { AppEnv } from '../../../app.types'
import { invalidField, notFound } from '../../../lib/domain-error'
import { parsePageRequest, toPage } from '../../../lib/drf-pagination'
import { fileResponse } from '../../../lib/http'
import { addDays, daysBetween } from '../../../lib/plain-date'
import type { PlainDate } from '../../../lib/plain-date.types'
import { requireMenu } from '../../../middleware/access'
import { versionTag } from '../../../middleware/if-match'
import { validationHook } from '../../../middleware/validation'
import { listFixedTermContracts } from '../contracts/contracts.repository'
import type { WorkContractRow } from '../contracts/contracts.types'
import type { HrContext } from '../shared/hr-context.types'
import { writeXlsx } from '../shared/xlsx-writer'
import { requireEmployee } from './employee-guard'
import { CONTRACT_EXPIRY_WARNING_DAYS, countEmployeesByStatus, findEmployeeView, listEmployeeViews } from './employees.repository'
import { commonInfoBody, createWageEmployeeBody, employeeListQuery, patchWageEmployeeBody } from './employees.schema'
import { maskedRegistrationNumber, serializeCommonInfo, serializeWageEmployee } from './employees.serializer'
import { createWageEmployee, deleteEmployee, patchWageEmployee, putCommonInfo } from './employees.service'
import type { EmployeeListFilter, EmployeeView } from './employees.types'
import { parseStatusParam, STATUS_LABEL } from './employees.utils'

const BASE = '/employment/wage-employees'
const ONE = `${BASE}/:employeeId{[0-9]+}`

/** Routes of 구성원 정보: the wage employee list, its counts and export, and each employee's basic information. */
export function employeeRoutes({ deps }: HrContext): Hono<AppEnv> {
  const menu = requireMenu('employment_employee')
  const serializeRows = (companyId: string, rows: EmployeeView[], today: PlainDate): Record<string, unknown>[] => {
    const contracts = groupByEmployee(listFixedTermContracts(deps.db, companyId, rows.map((row) => row.id)))
    return rows.map((row) => serializeWageEmployee(row, deps.cipher, today, contracts.get(row.id) ?? []))
  }
  const detail = (companyId: string, employeeId: number): { body: Record<string, unknown>; version: number } => {
    const today = deps.clock.today()
    const view = findEmployeeView(deps.db, companyId, employeeId, today)
    if (view === undefined) throw notFound('Employee')
    const [body] = serializeRows(companyId, [view], today)
    return { body: body ?? {}, version: view.version }
  }

  return new Hono<AppEnv>()
    .get(BASE, menu, zValidator('query', employeeListQuery, validationHook), (c) => {
      const query = c.req.valid('query')
      const page = parsePageRequest(query.limit, query.offset)
      const today = deps.clock.today()
      const { rows, count } = listEmployeeViews(deps.db, c.var.company.id, 'wage-salary', toFilter(query), today, page)
      return c.json(toPage(serializeRows(c.var.company.id, rows, today), count, page, c.req.url))
    })
    .get(`${BASE}/count-by-status`, menu, zValidator('query', employeeListQuery, validationHook), (c) => {
      const counts = countEmployeesByStatus(deps.db, c.var.company.id, 'wage-salary', toFilter(c.req.valid('query')), deps.clock.today())
      return c.json({
        all: counts.PRE_JOINED + counts.JOINED + counts.LEAVE + counts.RESIGNED,
        pre_joined: counts.PRE_JOINED,
        working: counts.JOINED,
        joined: counts.JOINED + counts.LEAVE,
        leave: counts.LEAVE,
        resigned: counts.RESIGNED,
      })
    })
    .get(`${BASE}/export`, menu, zValidator('query', employeeListQuery, validationHook), (c) => {
      const today = deps.clock.today()
      const { rows } = listEmployeeViews(deps.db, c.var.company.id, 'wage-salary', toFilter(c.req.valid('query')), today, null)
      const header = ['이름', '상태', '주민등록번호', '생년월일', '입사일', '퇴사일', '부서', '직위', '사번', '이메일', '담당업무', '계약형태', '계약종료일']
      const data = rows.map((row) => [
        row.name,
        STATUS_LABEL[row.status],
        maskedRegistrationNumber(row, deps.cipher),
        row.birth_date,
        row.join_date,
        row.leave_date,
        row.department_name,
        row.position_name,
        row.employee_number,
        row.email,
        row.work_code,
        row.contract_type === 'contract' ? '계약직' : row.contract_type === 'regular' ? '정규직' : null,
        row.contract_end_date,
      ])
      const bytes = writeXlsx('구성원', [header, ...data])
      return fileResponse(
        c,
        { original_name: `구성원_${today.replaceAll('-', '')}.xlsx`, mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
        bytes,
      )
    })
    .get(`${BASE}/contract-expiry-alert`, menu, (c) => {
      const today = deps.clock.today()
      const filter = toFilter({})
      const soon = listEmployeeViews(deps.db, c.var.company.id, 'wage-salary', { ...filter, contractFilter: 'expiring_soon', ordering: 'name' }, today, null).rows
      const expired = listEmployeeViews(deps.db, c.var.company.id, 'wage-salary', { ...filter, contractFilter: 'expired', ordering: 'name' }, today, null).rows
      const entry = (row: EmployeeView, status: 'expiring_soon' | 'expired'): Record<string, unknown> => ({
        id: row.id,
        name: row.name,
        department_name: row.department_name,
        position_name: row.position_name,
        contract_end_date: row.contract_end_date,
        days_left: row.contract_end_date === null ? null : daysBetween(today, row.contract_end_date as PlainDate),
        status,
      })
      return c.json({
        threshold_days: CONTRACT_EXPIRY_WARNING_DAYS,
        threshold_date: addDays(today, CONTRACT_EXPIRY_WARNING_DAYS),
        expiring_soon_count: soon.length,
        expired_count: expired.length,
        employees: [...expired.map((row) => entry(row, 'expired')), ...soon.map((row) => entry(row, 'expiring_soon'))],
      })
    })
    .post(BASE, menu, zValidator('json', createWageEmployeeBody, validationHook), (c) => {
      const view = createWageEmployee(deps, c.var.company.id, c.req.valid('json'), c.var.user.id)
      const { body, version } = detail(c.var.company.id, view.id)
      c.header('ETag', versionTag(version))
      return c.json(body, 201)
    })
    .get(ONE, menu, (c) => {
      const employee = requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId'))
      const { body, version } = detail(c.var.company.id, employee.id)
      c.header('ETag', versionTag(version))
      return c.json(body)
    })
    .patch(ONE, menu, zValidator('json', patchWageEmployeeBody, validationHook), (c) => {
      const employee = requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId'))
      patchWageEmployee(deps, employee, c.req.valid('json'))
      const { body, version } = detail(c.var.company.id, employee.id)
      c.header('ETag', versionTag(version))
      return c.json(body)
    })
    .delete(ONE, menu, (c) => {
      deleteEmployee(deps, requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId')))
      return c.body(null, 204)
    })
    .get(`${ONE}/common-info`, menu, (c) => {
      const employee = requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId'))
      const view = findEmployeeView(deps.db, c.var.company.id, employee.id, deps.clock.today())
      if (view === undefined) throw notFound('Employee')
      return c.json(serializeCommonInfo(view, deps.cipher))
    })
    .put(`${ONE}/common-info`, menu, zValidator('json', commonInfoBody, validationHook), (c) => {
      const employee = requireEmployee(deps.db, c.var.company.id, c.req.param('employeeId'))
      return c.json(serializeCommonInfo(putCommonInfo(deps, employee, c.req.valid('json')), deps.cipher))
    })
}

function toFilter(query: Partial<z.infer<typeof employeeListQuery>>): EmployeeListFilter {
  const statuses = parseStatusParam(query.status)
  if (statuses === null) throw invalidField('status', 'Use status codes 1-5 or PRE_JOINED, WORKING, JOINED, LEAVE, RESIGNED.')
  return {
    statuses,
    search: query.search ?? null,
    dateType: query.date_type ?? null,
    startDate: query.start_date ?? null,
    endDate: query.end_date ?? null,
    contractFilter: query.contract_filter ?? null,
    ordering: query.ordering ?? null,
  }
}

function groupByEmployee(contracts: readonly WorkContractRow[]): Map<number, WorkContractRow[]> {
  const grouped = new Map<number, WorkContractRow[]>()
  for (const contract of contracts) {
    const list = grouped.get(contract.employee_id) ?? []
    list.push(contract)
    grouped.set(contract.employee_id, list)
  }
  return grouped
}
