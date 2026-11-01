import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import type { AppDeps, AppEnv } from '../../../app.types'
import { transaction } from '../../../db/query'
import { notFound } from '../../../lib/domain-error'
import { parsePageRequest, toPage } from '../../../lib/drf-pagination'
import { requireMenu } from '../../../middleware/access'
import { validationHook } from '../../../middleware/validation'
import type { PayrollRateTable } from '../engine/rate-table.types'
import { rateTableFor } from '../reference/rate-tables.repository'
import * as repo from './settings.repository'
import {
  catalogQuery,
  deductionItemCreateBody,
  deductionItemPatchBody,
  deductionSettingsBody,
  listQuery,
  paymentItemCreateBody,
  paymentItemListQuery,
  paymentItemPatchBody,
  payrollTermsBody,
  usageStatusBody,
  workConditionCreateBody,
  workConditionPatchBody,
  workSchedulePolicyBody,
} from './settings.schema'
import {
  serializeCatalogItem,
  serializeDeductionItem,
  serializeDeductionSettings,
  serializePaymentItem,
  serializePayrollTerms,
  serializeUsageStatus,
  serializeWorkCondition,
  serializeWorkSchedulePolicy,
} from './settings.serializer'
import * as service from './settings.service'
import type { SettingsUsageCounter, WorkConditionRow, WorkSchedulePolicyRow } from './settings.types'

/**
 * Payroll settings routes (`급여 설정`), mounted under `/api/company/:companyId/employment/settings`.
 *
 * Every route requires the `payroll_setting` menu. A company's default
 * settings are created on its first request.
 */
export function settingsRoutes(deps: AppDeps, usage: SettingsUsageCounter): Hono<AppEnv> {
  const { db, clock } = deps
  const rates = (): PayrollRateTable => rateTableFor(db, clock.today().slice(0, 7))
  const run = <T>(companyId: string, fn: () => T): T =>
    transaction(db, () => {
      service.ensurePayrollSettings(db, companyId, clock.now())
      return fn()
    })
  const workCondition = (companyId: string, id: number): WorkConditionRow => {
    const row = repo.findWorkCondition(db, companyId, id)
    if (row === undefined) throw notFound('Work condition')
    return row
  }
  const policy = (companyId: string, id: number): WorkSchedulePolicyRow => {
    const row = repo.findWorkSchedulePolicy(db, companyId, id)
    if (row === undefined) throw notFound('Work schedule policy')
    return row
  }

  return new Hono<AppEnv>()
    .use('*', requireMenu('payroll_setting'))
    .get('/payroll-payment-categories', zValidator('query', catalogQuery, validationHook), (c) => {
      const table = rates()
      const results = service.searchCatalog(c.req.valid('query')).map((item) => serializeCatalogItem(item, table))
      return c.json({ count: results.length, next: null, previous: null, results })
    })
    .get('/payroll-payment-items', zValidator('query', paymentItemListQuery, validationHook), (c) => {
      const query = c.req.valid('query')
      const page = parsePageRequest(query.limit, query.offset)
      const table = rates()
      const filter: repo.PaymentItemFilter = {
        ...(query.is_taxable === undefined ? {} : { isTaxable: query.is_taxable }),
        ...(query.search === undefined ? {} : { search: query.search }),
      }
      const { rows, count } = run(c.var.company.id, () => repo.listPaymentItems(db, c.var.company.id, filter, page.limit, page.offset))
      return c.json(toPage(rows.map((row) => serializePaymentItem(row, table)), count, page, c.req.url))
    })
    .post('/payroll-payment-items', zValidator('json', paymentItemCreateBody, validationHook), (c) => {
      const table = rates()
      const row = run(c.var.company.id, () => service.createPaymentItem(db, c.var.company.id, c.req.valid('json'), table, clock.now()))
      return c.json(serializePaymentItem(row, table), 201)
    })
    .get('/payroll-payment-items/:id', (c) => {
      const row = run(c.var.company.id, () => service.requirePaymentItem(db, c.var.company.id, parseId(c.req.param('id'))))
      return c.json(serializePaymentItem(row, rates()))
    })
    .patch('/payroll-payment-items/:id', zValidator('json', paymentItemPatchBody, validationHook), (c) => {
      const table = rates()
      const id = parseId(c.req.param('id'))
      const row = run(c.var.company.id, () => service.updatePaymentItem(db, c.var.company.id, id, c.req.valid('json'), table, clock.now()))
      return c.json(serializePaymentItem(row, table))
    })
    .delete('/payroll-payment-items/:id', (c) => {
      run(c.var.company.id, () => service.removePaymentItem(db, c.var.company.id, parseId(c.req.param('id'))))
      return c.body(null, 204)
    })
    .get('/payroll-deduction', (c) => {
      const row = run(c.var.company.id, () => repo.findDeductionSettings(db, c.var.company.id))
      if (row === undefined) throw notFound('Deduction settings')
      return c.json(serializeDeductionSettings(row))
    })
    .patch('/payroll-deduction', zValidator('json', deductionSettingsBody, validationHook), (c) => {
      const row = run(c.var.company.id, () => {
        service.patchDeductionSettings(db, c.var.company.id, c.req.valid('json'), clock.now())
        return repo.findDeductionSettings(db, c.var.company.id)
      })
      if (row === undefined) throw notFound('Deduction settings')
      return c.json(serializeDeductionSettings(row))
    })
    .get('/payroll-deduction-items', zValidator('query', listQuery, validationHook), (c) => {
      const query = c.req.valid('query')
      const page = parsePageRequest(query.limit, query.offset)
      const { rows, count } = run(c.var.company.id, () => repo.listDeductionItems(db, c.var.company.id, page.limit, page.offset))
      return c.json(toPage(rows.map(serializeDeductionItem), count, page, c.req.url))
    })
    .post('/payroll-deduction-items', zValidator('json', deductionItemCreateBody, validationHook), (c) => {
      const row = run(c.var.company.id, () => service.createDeductionItem(db, c.var.company.id, c.req.valid('json'), clock.now()))
      return c.json(serializeDeductionItem(row), 201)
    })
    .get('/payroll-deduction-items/:id', (c) => {
      const row = run(c.var.company.id, () => service.requireDeductionItem(db, c.var.company.id, parseId(c.req.param('id'))))
      return c.json(serializeDeductionItem(row))
    })
    .patch('/payroll-deduction-items/:id', zValidator('json', deductionItemPatchBody, validationHook), (c) => {
      const id = parseId(c.req.param('id'))
      const row = run(c.var.company.id, () => service.updateDeductionItem(db, c.var.company.id, id, c.req.valid('json'), clock.now()))
      return c.json(serializeDeductionItem(row))
    })
    .delete('/payroll-deduction-items/:id', (c) => {
      const id = parseId(c.req.param('id'))
      run(c.var.company.id, () => {
        service.requireDeductionItem(db, c.var.company.id, id)
        repo.deleteDeductionItem(db, c.var.company.id, id)
      })
      return c.body(null, 204)
    })
    .get('/payroll-terms', (c) => {
      const row = run(c.var.company.id, () => repo.findTerms(db, c.var.company.id))
      if (row === undefined) throw notFound('Payroll terms')
      return c.json(serializePayrollTerms(row, rates()))
    })
    .patch('/payroll-terms', zValidator('json', payrollTermsBody, validationHook), (c) => {
      const row = run(c.var.company.id, () => {
        service.patchPayrollTerms(db, c.var.company.id, c.req.valid('json'), clock.now())
        return repo.findTerms(db, c.var.company.id)
      })
      if (row === undefined) throw notFound('Payroll terms')
      return c.json(serializePayrollTerms(row, rates()))
    })
    .get('/work-conditions', zValidator('query', listQuery, validationHook), (c) => {
      const query = c.req.valid('query')
      const page = parsePageRequest(query.limit, query.offset)
      const { rows, count } = run(c.var.company.id, () => repo.listWorkConditions(db, c.var.company.id, query.is_active, page.limit, page.offset))
      return c.json(toPage(rows.map(serializeWorkCondition), count, page, c.req.url))
    })
    .post('/work-conditions', zValidator('json', workConditionCreateBody, validationHook), (c) => {
      const row = run(c.var.company.id, () => workCondition(c.var.company.id, service.createWorkCondition(db, c.var.company.id, c.req.valid('json'), clock.now())))
      return c.json(serializeWorkCondition(row), 201)
    })
    .get('/work-conditions/:id', (c) => {
      const row = run(c.var.company.id, () => workCondition(c.var.company.id, parseId(c.req.param('id'))))
      return c.json(serializeWorkCondition(row))
    })
    .patch('/work-conditions/:id', zValidator('json', workConditionPatchBody, validationHook), (c) => {
      const id = parseId(c.req.param('id'))
      const row = run(c.var.company.id, () => {
        service.updateWorkCondition(db, c.var.company.id, id, c.req.valid('json'), clock.now())
        return workCondition(c.var.company.id, id)
      })
      return c.json(serializeWorkCondition(row))
    })
    .delete('/work-conditions/:id', (c) => {
      run(c.var.company.id, () => service.removeWorkCondition(db, c.var.company.id, parseId(c.req.param('id')), usage))
      return c.body(null, 204)
    })
    .get('/work-conditions/:id/usage-status', (c) => {
      const id = parseId(c.req.param('id'))
      const row = run(c.var.company.id, () => workCondition(c.var.company.id, id))
      return c.json(serializeUsageStatus(row.id, row.is_active === 1, usage.workConditionUsages(c.var.company.id, id)))
    })
    .patch('/work-conditions/:id/usage-status', zValidator('json', usageStatusBody, validationHook), (c) => {
      const id = parseId(c.req.param('id'))
      const row = run(c.var.company.id, () => {
        workCondition(c.var.company.id, id)
        repo.updateWorkCondition(db, c.var.company.id, id, { is_active: c.req.valid('json').is_active ? 1 : 0 }, clock.now())
        return workCondition(c.var.company.id, id)
      })
      return c.json({ ...serializeWorkCondition(row), ...serializeUsageStatus(row.id, row.is_active === 1, usage.workConditionUsages(c.var.company.id, id)) })
    })
    .get('/work-schedule-policies', zValidator('query', listQuery, validationHook), (c) => {
      const query = c.req.valid('query')
      const page = parsePageRequest(query.limit, query.offset)
      const { rows, count } = run(c.var.company.id, () => repo.listWorkSchedulePolicies(db, c.var.company.id, query.is_active, page.limit, page.offset))
      return c.json(toPage(rows.map(serializeWorkSchedulePolicy), count, page, c.req.url))
    })
    .post('/work-schedule-policies', zValidator('json', workSchedulePolicyBody, validationHook), (c) => {
      const fields = service.validateWorkSchedulePolicy(c.req.valid('json'))
      const row = run(c.var.company.id, () => policy(c.var.company.id, repo.insertWorkSchedulePolicy(db, c.var.company.id, fields, clock.now())))
      return c.json(serializeWorkSchedulePolicy(row), 201)
    })
    .get('/work-schedule-policies/:id', (c) => {
      const row = run(c.var.company.id, () => policy(c.var.company.id, parseId(c.req.param('id'))))
      return c.json(serializeWorkSchedulePolicy(row))
    })
    .put('/work-schedule-policies/:id', zValidator('json', workSchedulePolicyBody, validationHook), (c) => {
      const id = parseId(c.req.param('id'))
      const fields = service.validateWorkSchedulePolicy(c.req.valid('json'))
      const row = run(c.var.company.id, () => {
        policy(c.var.company.id, id)
        repo.replaceWorkSchedulePolicy(db, c.var.company.id, id, fields, clock.now())
        return policy(c.var.company.id, id)
      })
      return c.json(serializeWorkSchedulePolicy(row))
    })
    .delete('/work-schedule-policies/:id', (c) => {
      run(c.var.company.id, () => service.removeWorkSchedulePolicy(db, c.var.company.id, parseId(c.req.param('id')), usage))
      return c.body(null, 204)
    })
    .get('/work-schedule-policies/:id/usage-status', (c) => {
      const id = parseId(c.req.param('id'))
      const row = run(c.var.company.id, () => policy(c.var.company.id, id))
      return c.json(serializeUsageStatus(row.id, row.is_active === 1, usage.workSchedulePolicyUsages(c.var.company.id, id)))
    })
    .patch('/work-schedule-policies/:id/usage-status', zValidator('json', usageStatusBody, validationHook), (c) => {
      const id = parseId(c.req.param('id'))
      const row = run(c.var.company.id, () => {
        policy(c.var.company.id, id)
        repo.setWorkSchedulePolicyActive(db, c.var.company.id, id, c.req.valid('json').is_active, clock.now())
        return policy(c.var.company.id, id)
      })
      return c.json({ ...serializeWorkSchedulePolicy(row), ...serializeUsageStatus(row.id, row.is_active === 1, usage.workSchedulePolicyUsages(c.var.company.id, id)) })
    })
}

function parseId(value: string | undefined): number {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) throw notFound('Resource')
  return id
}
