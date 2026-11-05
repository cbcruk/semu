import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { AppDeps, AppEnv } from '../../../app.types'
import { readMultipartUpload } from '../../../lib/http'
import { validationHook } from '../../../middleware/validation'
import { yearMonthFromTargetDate } from '../engine/rate-table'
import type { PayrollRateTable, YearMonth } from '../engine/rate-table.types'
import { calculateWageIncomeTax, generateSimpleTaxTable, MIDPOINT_FORMULA } from '../engine/wage-income-tax'
import { parsePayrollSheet, PAYROLL_TEMPLATE_NAME, payrollTemplateCsv } from './payroll-excel.utils'
import { rateTableFor } from './rate-tables.repository'
import { BUSINESS_INCOME_TYPES, codesInForce, NATION_CODES, OTHER_INCOME_TYPES, SPECIAL_OCCUPATION_TYPES } from './reference-data'
import { simulate } from './simulate'
import { simpleTaxQuery, simulateBody, targetDateQuery } from './simulate.schema'

/**
 * Payroll reference data, tax-rate tables and the salary calculator, outside any company.
 *
 * Mounted on the authenticated `account` router: the client calls these with
 * its session but without a company in the path. `target_date` (`YYYYMM`)
 * defaults to the current month.
 */
export function referenceRoutes(deps: AppDeps): Hono<AppEnv> {
  const monthOf = (targetDate: string | undefined): YearMonth =>
    (targetDate === undefined ? undefined : yearMonthFromTargetDate(targetDate)) ?? deps.clock.today().slice(0, 7)
  const rates = (month: YearMonth): PayrollRateTable => rateTableFor(deps.db, month)
  const uploadLimit = bodyLimit({
    maxSize: deps.maxUploadBytes,
    onError: (c) => c.json({ detail: 'The file is too large.', code: 'PAYLOAD_TOO_LARGE' }, 413),
  })

  return new Hono<AppEnv>()
    .get('/api/payroll/business-income-types', zValidator('query', targetDateQuery, validationHook), (c) => {
      const month = monthOf(c.req.valid('query').target_date)
      return c.json(
        codesInForce(BUSINESS_INCOME_TYPES, month).map((type) => ({ code: type.code, name: type.name, detail_type: type.detailType, verified: type.verified })),
      )
    })
    .get('/api/payroll/special-occ-types', zValidator('query', targetDateQuery, validationHook), (c) => {
      const month = monthOf(c.req.valid('query').target_date)
      return c.json(codesInForce(SPECIAL_OCCUPATION_TYPES, month).map((type) => ({ code: type.code, name: type.name, verified: type.verified })))
    })
    .get('/api/payroll/other-labor-income-types', zValidator('query', targetDateQuery, validationHook), (c) => {
      const month = monthOf(c.req.valid('query').target_date)
      return c.json(
        codesInForce(OTHER_INCOME_TYPES, month).map((type) => ({
          code: type.code,
          name: type.name,
          necessary_expense_rate: type.expenseRatePpm === null ? null : type.expenseRatePpm / 10_000,
          tax_rate: type.taxRatePpm / 10_000,
          verified: type.verified,
        })),
      )
    })
    .get('/api/payroll/nation-codes', (c) => c.json(NATION_CODES))
    .get('/api/payroll/excel', (c) =>
      c.body(new TextEncoder().encode(payrollTemplateCsv()), 200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(PAYROLL_TEMPLATE_NAME)}`,
        'X-Content-Type-Options': 'nosniff',
      }),
    )
    .post('/api/payroll/excel', uploadLimit, async (c) => {
      const { upload } = await readMultipartUpload(c)
      return c.json(parsePayrollSheet(new TextDecoder().decode(upload.bytes)))
    })
    .get('/api/tax-rates/simple', zValidator('query', simpleTaxQuery, validationHook), (c) => {
      const query = c.req.valid('query')
      const month = monthOf(query.target_date)
      const table = rates(month)
      if (query.monthly_pay === undefined) {
        return c.json({
          target_date: month.replace('-', ''),
          rate_table: table.effectiveFrom,
          method: MIDPOINT_FORMULA.name,
          verified: false,
          rows: generateSimpleTaxTable(table),
        })
      }
      const dependants = query.dependants ?? 1
      const children = query.children ?? 0
      const tax = calculateWageIncomeTax(
        query.monthly_pay,
        { method: 'tax_table_based', dependants, childrenAged8To20: children, withholdingRatio: 100 },
        table,
        MIDPOINT_FORMULA,
      )
      return c.json({
        target_date: month.replace('-', ''),
        rate_table: table.effectiveFrom,
        method: MIDPOINT_FORMULA.name,
        verified: false,
        monthly_pay: query.monthly_pay,
        dependants,
        children,
        income_tax: tax.incomeTax,
        local_income_tax: tax.localIncomeTax,
      })
    })
    .get('/api/tax-rates/necessary-expenses', zValidator('query', targetDateQuery, validationHook), (c) => {
      const month = monthOf(c.req.valid('query').target_date)
      return c.json(
        codesInForce(OTHER_INCOME_TYPES, month).map((type) => ({
          income_type_code: type.code,
          name: type.name,
          necessary_expense_rate: type.expenseRatePpm === null ? null : type.expenseRatePpm / 10_000,
          verified: type.verified,
        })),
      )
    })
    .post('/api/payroll/calculator/simulate', zValidator('json', simulateBody, validationHook), (c) => {
      const body = c.req.valid('json')
      const month = monthOf(body.target_date)
      return c.json(simulate(body, month, rates(month)))
    })
}
