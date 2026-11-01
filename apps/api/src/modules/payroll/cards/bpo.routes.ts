import { zValidator } from '@hono/zod-validator'
import { type Context, Hono } from 'hono'
import type { AppDeps, AppEnv } from '../../../app.types'
import { transaction } from '../../../db/query'
import { DomainError, invalidField, notFound } from '../../../lib/domain-error'
import { parsePageRequest, toPage } from '../../../lib/drf-pagination'
import { addMonths } from '../../../lib/plain-date'
import type { PlainDate } from '../../../lib/plain-date.types'
import { requireMenu } from '../../../middleware/access'
import { requireIfMatch, versionTag } from '../../../middleware/if-match'
import { validationHook } from '../../../middleware/validation'
import type { PayrollIncomeType } from '../engine/engine.types'
import { resolvePayrollAdapters } from '../adapters/payroll-adapters'
import { parsePayrollSheet } from '../reference/payroll-excel.utils'
import { findTerms } from '../settings/settings.repository'
import { ensurePayrollSettings } from '../settings/settings.service'
import { isWithholdingFiled } from '../withholding/withholding-link'
import { bulkUpdateCardItems, listCardItems } from './card-items.service'
import * as repo from './cards.repository'
import {
  candidatesBody,
  cardSummaryQuery,
  createCardBody,
  exportQuery,
  itemsBulkBody,
  itemsQuery,
  managerMemoBody,
  paymentDateListQuery,
  payslipDownloadBody,
  payslipSendBody,
  putCardBody,
  rowIdsBody,
  shifteeBody,
  simpleRowsBody,
  wageRowPatchSchema,
  wageRowsUpdateBody,
  workInputBody,
} from './cards.schema'
import { serializeCard, serializeRow } from './cards.serializer'
import * as cards from './cards.service'
import type { BpoSegment, CardRow, DailyInputData, PayrollRowRecord, PayslipGroup, WageInputData } from './cards.types'
import {
  BPO_SEGMENTS,
  incomeTypeOfSegment,
  incomeTypesOfGroup,
  isWageIncome,
  paymentDateIn,
  paymentMonthOf,
  parseBpoSegment,
  parseJsonColumn,
  parsePayslipGroup,
  SIMPLE_SEGMENTS,
  WAGE_SEGMENTS,
} from './cards.utils'
import * as companyRecords from './company-records.service'
import * as payslips from './payslips.service'
import * as rows from './rows.service'

type Ctx = Context<AppEnv>

/**
 * BPO payroll routes (`급여 정산`), mounted under `/api/company/:companyId/payroll/bpo`.
 *
 * Every route requires the `payroll_settlement` menu. Agency actions
 * (`request-approval`, `export-to-desk`, `manager-memo` writes) share these
 * paths and are told apart by `c.var.access.actor` (spec 5.11).
 */
export function bpoRoutes(deps: AppDeps): Hono<AppEnv> {
  const { db, clock, cipher } = deps
  const adapters = resolvePayrollAdapters(deps)
  const caller = (c: Ctx): cards.CardCaller => ({ actor: c.var.access.actor, userId: c.var.user.id })
  const run = <T>(c: Ctx, fn: () => T): T =>
    transaction(db, () => {
      ensurePayrollSettings(db, c.var.company.id, clock.now())
      return fn()
    })
  const cardOf = (c: Ctx): CardRow => cards.requireCard(db, c.var.company.id, parseId(c.req.param('cardId'), 'Payroll card'), 'bpo')
  const segmentOf = (c: Ctx, allowed: readonly BpoSegment[] = BPO_SEGMENTS): PayrollIncomeType => {
    const segment = parseBpoSegment(c.req.param('segment') ?? '')
    if (segment === undefined || !allowed.includes(segment)) throw notFound('Payroll input segment')
    return incomeTypeOfSegment(segment)
  }
  const cardResponse = (c: Ctx, card: CardRow, status: 200 | 201 = 200): Response => {
    c.header('ETag', versionTag(card.version))
    return c.json(cardBody(card), status)
  }
  const cardBody = (card: CardRow): Record<string, unknown> =>
    serializeCard(card, repo.listRows(db, card.company_id, card.id), { withholding_filed: isWithholdingFiled(db, card.company_id, paymentMonthOf(card.payment_date)) })
  const rowsResponse = (c: Ctx, card: CardRow, incomeTypes: readonly PayrollIncomeType[]): Response => {
    const payslipRows = repo.listPayslips(db, card.id)
    return c.json({
      card: cardBody(card),
      results: repo.listRows(db, card.company_id, card.id, incomeTypes).map((row) => serializeRow(row, cipher, payslipRows.get(row.id))),
    })
  }
  const transitionRoute = (name: 'requestApproval' | 'approve' | 'reject') => (c: Ctx) =>
    cardResponse(c, run(c, () => cards.transition(deps, cardOf(c), name, caller(c), c.var.expectedVersion)))

  return new Hono<AppEnv>()
    .use('*', requireMenu('payroll_settlement'))
    .get('/payment-date-list', zValidator('query', paymentDateListQuery, validationHook), (c) =>
      c.json(run(c, () => paymentDateList(deps, c.var.company.id, c.req.valid('query').attribution_month ?? clock.today().slice(0, 7)))),
    )
    .get('/card-summary', zValidator('query', cardSummaryQuery, validationHook), (c) => {
      const query = c.req.valid('query')
      const page = parsePageRequest(query.limit, query.offset)
      const list = repo.listCards(db, c.var.company.id, {
        generation: 'bpo',
        ...(query.year === undefined ? {} : { year: query.year }),
        ...(query.status === undefined ? {} : { statuses: [query.status] }),
      })
      return c.json(toPage(list.slice(page.offset, page.offset + page.limit).map(cardBody), list.length, page, c.req.url))
    })
    .post('/card', zValidator('json', createCardBody, validationHook), (c) => {
      const body = c.req.valid('json')
      const card = run(c, () =>
        cards.createCard(deps, c.var.company.id, { generation: 'bpo', attributionMonth: body.attribution_month, paymentDate: body.payment_date, title: body.title }, caller(c)),
      )
      return cardResponse(c, card, 201)
    })
    .get('/card/:cardId', (c) => cardResponse(c, cardOf(c)))
    .put('/card/:cardId', zValidator('json', putCardBody, validationHook), (c) => {
      const body = c.req.valid('json')
      const card = run(c, () => {
        let current = cardOf(c)
        if (body.title !== undefined || body.payment_date !== undefined) {
          current = cards.updateCardHeader(deps, current, { title: body.title, payment_date: body.payment_date }, caller(c))
        }
        if (body.status === undefined || body.status === current.status) return current
        const version = readIfMatch(c)
        return cards.transition(deps, current, body.status === 'calculated' ? 'confirmInput' : 'reopenInput', caller(c), version)
      })
      return cardResponse(c, card)
    })
    .delete('/card/:cardId', (c) => {
      run(c, () => cards.removeCard(deps, cardOf(c), caller(c)))
      return c.body(null, 204)
    })
    .get('/card/:cardId/status', (c) => {
      const card = cardOf(c)
      const body = cardBody(card)
      c.header('ETag', versionTag(card.version))
      return c.json({ id: card.id, status: card.status, legacy_status: body['legacy_status'], step: body['step'], step_count: 3, version: card.version })
    })
    .post('/card/:cardId/request-approval', requireIfMatch(), transitionRoute('requestApproval'))
    .post('/card/:cardId/approve', requireIfMatch(), transitionRoute('approve'))
    .post('/card/:cardId/reject', requireIfMatch(), transitionRoute('reject'))
    .post('/card/:cardId/cancel-approval', requireIfMatch(), (c) => {
      const card = run(c, () => {
        const current = cardOf(c)
        const name = current.status === 'approval_requested' ? 'withdrawApprovalRequest' : 'cancelApproval'
        return cards.transition(deps, current, name, caller(c), c.var.expectedVersion)
      })
      return cardResponse(c, card)
    })
    .post('/card/:cardId/export-to-desk', requireIfMatch(), zValidator('query', exportQuery, validationHook), async (c) => {
      const card = await companyRecords.exportToDesk(
        deps,
        adapters.deskExport,
        c.var.company.id,
        parseId(c.req.param('cardId'), 'Payroll card'),
        c.req.valid('query').export_type,
        caller(c),
        c.var.expectedVersion,
      )
      return cardResponse(c, card)
    })
    .get('/card/:cardId/payment-items', zValidator('query', itemsQuery, validationHook), (c) =>
      c.json({ results: run(c, () => listCardItems(deps, cardOf(c), 'payment', c.req.valid('query').employment_type)) }),
    )
    .post('/card/:cardId/payment-items/bulk', zValidator('json', itemsBulkBody, validationHook), (c) => {
      const card = run(c, () => {
        const current = cardOf(c)
        bulkUpdateCardItems(deps, current, 'payment', c.req.valid('json'), caller(c))
        return current
      })
      return c.json({ results: run(c, () => listCardItems(deps, card, 'payment', c.req.valid('json').employment_type)) })
    })
    .get('/card/:cardId/deduction-items', zValidator('query', itemsQuery, validationHook), (c) =>
      c.json({ results: run(c, () => listCardItems(deps, cardOf(c), 'deduction', c.req.valid('query').employment_type)) }),
    )
    .post('/card/:cardId/deduction-items/bulk', zValidator('json', itemsBulkBody, validationHook), (c) => {
      const card = run(c, () => {
        const current = cardOf(c)
        bulkUpdateCardItems(deps, current, 'deduction', c.req.valid('json'), caller(c))
        return current
      })
      return c.json({ results: run(c, () => listCardItems(deps, card, 'deduction', c.req.valid('json').employment_type)) })
    })
    .post('/card/:cardId/payslip/download', zValidator('json', payslipDownloadBody, validationHook), async (c) => {
      const body = c.req.valid('json')
      const bytes = await payslips.renderPayslips(deps, cardOf(c), body.row_ids, body.income_type, c.var.company.name, adapters.pdfRenderer)
      return c.body(new Uint8Array(bytes), 200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('급여명세서.pdf')}`,
        'Cache-Control': 'private, no-store',
      })
    })
    .post('/card/:cardId/payslip/send', zValidator('json', payslipSendBody, validationHook), async (c) => {
      const results = await payslips.sendPayslips(
        deps,
        c.var.company.id,
        parseId(c.req.param('cardId'), 'Payroll card'),
        'bpo',
        c.req.valid('json').row_ids,
        caller(c),
        c.var.company.name,
        adapters,
      )
      return c.json({ results, card: cardBody(cardOf(c)) })
    })
    .get('/card/:cardId/:group/payslip', (c) => c.json({ results: payslips.listPayslipRows(deps, cardOf(c), groupOf(c)) }))
    .get('/card/:cardId/:group/payslip/:rowId', (c) => {
      const card = cardOf(c)
      const row = rows.requireRow(db, card, parseId(c.req.param('rowId'), 'Payroll row'), incomeTypesOfGroup(groupOf(c)))
      return c.json(payslips.payslipDetail(deps, card, row))
    })
    .get('/card/:cardId/:segment/payroll-input/candidates', (c) => {
      const card = cardOf(c)
      const incomeType = segmentOf(c)
      return c.json({
        results: rows.listCandidates(deps, card, incomeType).map(({ employee }) => ({
          employee_id: employee.id,
          name: employee.name,
          birth_date: employee.birthDate,
          department: employee.departmentName,
          position: employee.positionName,
          join_date: employee.joinDate,
          leave_date: employee.leaveDate,
        })),
      })
    })
    .post('/card/:cardId/:segment/payroll-input/candidates', zValidator('json', candidatesBody, validationHook), (c) => {
      const incomeType = segmentOf(c)
      const card = run(c, () => {
        const current = cardOf(c)
        rows.addCandidates(deps, current, incomeType, c.req.valid('json').employee_ids, caller(c))
        return current
      })
      c.status(201)
      return rowsResponse(c, card, [incomeType])
    })
    .get('/card/:cardId/:segment/payroll-input', (c) => rowsResponse(c, cardOf(c), [segmentOf(c)]))
    .post('/card/:cardId/:segment/payroll-input', zValidator('json', simpleRowsBody, validationHook), (c) => {
      const incomeType = segmentOf(c, SIMPLE_SEGMENTS) as 'daily' | 'business' | 'other'
      const card = run(c, () => {
        const current = cardOf(c)
        rows.upsertSimpleRows(deps, current, incomeType, c.req.valid('json').rows, caller(c))
        return current
      })
      return rowsResponse(c, card, [incomeType])
    })
    .post('/card/:cardId/:segment/payroll-input/excel', async (c) => {
      const incomeType = segmentOf(c, SIMPLE_SEGMENTS) as 'daily' | 'business' | 'other'
      const form = await c.req.parseBody()
      const file = form['file']
      if (!(file instanceof File)) throw invalidField('file', 'Upload the CSV template as `file`.')
      const sheet = parsePayrollSheet(await file.text())
      const matching = sheet.rows.filter((row) => row.income_type === incomeType)
      const created = run(c, () =>
        matching.length === 0
          ? []
          : rows.upsertSimpleRows(
              deps,
              cardOf(c),
              incomeType,
              matching.map((row) => ({
                name: row.name,
                resident_number: row.resident_number === '' ? null : row.resident_number,
                is_foreigner: row.is_foreigner,
                residence_country: row.residence_country.length === 2 ? row.residence_country : 'KR',
                ...(row.payment_date === '' ? {} : { payment_date: row.payment_date as PlainDate }),
                pay_amount: row.pay_amount,
                ...(incomeType === 'daily' && row.work_days !== null ? { work_days: row.work_days } : {}),
                ...(incomeType === 'business' ? { business_income_type_code: row.business_income_type_code } : {}),
                ...(incomeType === 'other' ? { other_income_type_code: row.other_income_type_code } : {}),
              })),
              caller(c),
            ),
      )
      return c.json({ created_ids: created, skipped: sheet.rows.length - matching.length, errors: sheet.errors }, 201)
    })
    .post('/card/:cardId/:segment/payroll-input/update', zValidator('json', wageRowsUpdateBody, validationHook), (c) => {
      const incomeType = segmentOf(c, WAGE_SEGMENTS)
      const card = run(c, () => {
        const current = cardOf(c)
        rows.patchWageRows(deps, current, incomeType, c.req.valid('json').rows, caller(c))
        return current
      })
      return rowsResponse(c, card, [incomeType])
    })
    .post('/card/:cardId/:segment/payroll-input/calculate', zValidator('json', rowIdsBody, validationHook), (c) => {
      const incomeType = segmentOf(c)
      const card = run(c, () => {
        const current = cardOf(c)
        rows.calculateRows(deps, current, [incomeType], c.req.valid('json').ids, caller(c))
        return current
      })
      return rowsResponse(c, card, [incomeType])
    })
    .post('/card/:cardId/:segment/payroll-input/delete', zValidator('json', rowIdsBody, validationHook), (c) => {
      const incomeType = segmentOf(c)
      const ids = c.req.valid('json').ids ?? []
      if (ids.length === 0) throw invalidField('ids', 'Select the rows to delete.')
      const card = run(c, () => {
        const current = cardOf(c)
        rows.deleteRowsOf(deps, current, [incomeType], ids, caller(c))
        return current
      })
      return rowsResponse(c, card, [incomeType])
    })
    .post('/card/:cardId/:segment/payroll-input/refresh-employee-info', zValidator('json', rowIdsBody, validationHook), (c) => {
      const incomeType = segmentOf(c, WAGE_SEGMENTS)
      const card = run(c, () => {
        const current = cardOf(c)
        rows.refreshRows(deps, current, [incomeType], c.req.valid('json').ids, caller(c))
        return current
      })
      return rowsResponse(c, card, [incomeType])
    })
    .post('/card/:cardId/:segment/payroll-input/reset-calculation', zValidator('json', rowIdsBody, validationHook), (c) => {
      const incomeType = segmentOf(c, WAGE_SEGMENTS)
      const card = run(c, () => {
        const current = cardOf(c)
        rows.resetRows(deps, current, [incomeType], c.req.valid('json').ids, caller(c))
        return current
      })
      return rowsResponse(c, card, [incomeType])
    })
    .get('/card/:cardId/:segment/payroll-input/:rowId/work-infos', (c) => {
      const incomeType = segmentOf(c, WAGE_SEGMENTS)
      const row = rows.requireRow(db, cardOf(c), parseId(c.req.param('rowId'), 'Payroll row'), [incomeType])
      return c.json(workInfoOf(row))
    })
    .get('/card/:cardId/:segment/payroll-input/:rowId/payroll-info', (c) => {
      const incomeType = segmentOf(c, WAGE_SEGMENTS)
      const row = rows.requireRow(db, cardOf(c), parseId(c.req.param('rowId'), 'Payroll row'), [incomeType])
      return c.json(serializeRow(row, cipher))
    })
    .put('/card/:cardId/:segment/payroll-input/:rowId', zValidator('json', wageRowPatchSchema, validationHook), (c) => {
      const incomeType = segmentOf(c, WAGE_SEGMENTS)
      const rowId = parseId(c.req.param('rowId'), 'Payroll row')
      const row = run(c, () => {
        const card = cardOf(c)
        rows.patchWageRows(deps, card, incomeType, [{ ...c.req.valid('json'), id: rowId }], caller(c))
        return rows.requireRow(db, card, rowId, [incomeType])
      })
      return c.json(serializeRow(row, cipher))
    })
    .get('/card/:cardId/:segment/work-input', (c) => {
      const incomeType = segmentOf(c, [...WAGE_SEGMENTS, 'daily'])
      const card = cardOf(c)
      return c.json({ card: cardBody(card), results: repo.listRows(db, card.company_id, card.id, [incomeType]).map(workInfoOf) })
    })
    .post('/card/:cardId/:segment/work-input', zValidator('json', workInputBody, validationHook), (c) => {
      const incomeType = segmentOf(c, [...WAGE_SEGMENTS, 'daily'])
      const card = run(c, () => {
        const current = cardOf(c)
        rows.saveWorkSheet(deps, current, incomeType, c.req.valid('json').rows, caller(c))
        return current
      })
      return c.json({ card: cardBody(card), results: repo.listRows(db, card.company_id, card.id, [incomeType]).map(workInfoOf) })
    })
    .get('/manager-memo', (c) => c.json(companyRecords.managerMemoOf(deps, c.var.company.id)))
    .post('/manager-memo', zValidator('json', managerMemoBody, validationHook), (c) =>
      c.json(run(c, () => companyRecords.saveManagerMemo(deps, c.var.company.id, c.req.valid('json').content, caller(c)))),
    )
    .get('/shiftee-integration', (c) => c.json(companyRecords.serializeIntegration(repo.findIntegration(db, c.var.company.id))))
    .post('/shiftee-integration', zValidator('json', shifteeBody, validationHook), async (c) => {
      const body = c.req.valid('json')
      const row = await companyRecords.linkShiftee(
        deps,
        adapters.shiftee,
        c.var.company.id,
        { companyName: body.company_name ?? c.var.company.name, representativeName: body.representative_name ?? '대표자', email: body.email },
        caller(c),
      )
      return c.json(companyRecords.serializeIntegration(row), 201)
    })
    .delete('/shiftee-integration', async (c) => c.json(companyRecords.serializeIntegration(await companyRecords.unlinkShiftee(deps, adapters.shiftee, c.var.company.id))))
}

/**
 * Lists the payment dates offered when a card is created (`payment-date-list`).
 *
 * The terms' payment day in the attribution month (당월) and the next month
 * (익월); the one matching `payment_month` is the default. Dates whose
 * payment month already has a filed withholding return are unavailable.
 */
export function paymentDateList(deps: Pick<AppDeps, 'db'>, companyId: string, attributionMonth: string): Record<string, unknown> {
  const terms = findTerms(deps.db, companyId)
  if (terms === undefined) throw new Error(`Payroll terms of ${companyId} are missing.`)
  const options = [
    { payment_month: 'current', date: paymentDateIn(attributionMonth, terms.payment_day) },
    { payment_month: 'next', date: paymentDateIn(addMonths(`${attributionMonth}-01` as PlainDate, 1).slice(0, 7), terms.payment_day) },
  ]
  const results = options.map((option) => {
    const filed = isWithholdingFiled(deps.db, companyId, paymentMonthOf(option.date))
    return {
      payment_date: option.date,
      payment_month: option.payment_month,
      is_default: option.payment_month === (terms.payment_month === 'next' ? 'next' : 'current'),
      available: !filed,
      reason: filed ? 'withholding_filed' : null,
    }
  })
  return { attribution_month: attributionMonth, default_payment_date: results.find((entry) => entry.is_default)?.payment_date ?? null, results }
}

function workInfoOf(row: PayrollRowRecord): Record<string, unknown> {
  if (!isWageIncome(row.income_type)) {
    const data = parseJsonColumn<DailyInputData>(row.input, {} as DailyInputData)
    return { id: row.id, name: row.name, work_dates: data.work_dates, work_days: data.work_dates.length > 0 ? data.work_dates.length : data.work_days, avg_daily_hours: data.avg_daily_hours }
  }
  const data = parseJsonColumn<WageInputData>(row.input, {} as WageInputData)
  return { id: row.id, name: row.name, employee_id: row.employee_id, worked_days: data.worked_days, ...data.work }
}

function groupOf(c: Ctx): PayslipGroup {
  const group = parsePayslipGroup(c.req.param('group') ?? '')
  if (group === undefined) throw notFound('Payslip group')
  return group
}

function readIfMatch(c: Ctx): number {
  const header = c.req.header('If-Match')
  if (header === undefined) throw new DomainError('PRECONDITION_REQUIRED', 'Send If-Match with the payroll card version to change its status.')
  const match = /^(?:W\/)?"?(\d+)"?$/.exec(header.trim())
  if (match === null) throw new DomainError('VERSION_CONFLICT', 'If-Match must carry a version such as "3".')
  return Number(match[1])
}

function parseId(value: string | undefined, resource: string): number {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) throw notFound(resource)
  return id
}
