import { zValidator } from '@hono/zod-validator'
import { type Context, Hono } from 'hono'
import type { AppDeps, AppEnv } from '../../../app.types'
import { transaction } from '../../../db/query'
import { DomainError, notFound } from '../../../lib/domain-error'
import { requireMenu } from '../../../middleware/access'
import { authenticate } from '../../../middleware/auth'
import { companyScope } from '../../../middleware/company-scope'
import { validationHook } from '../../../middleware/validation'
import type { PayrollIncomeType } from '../engine/engine.types'
import { resolvePayrollAdapters } from '../adapters/payroll-adapters'
import { ensurePayrollSettings } from '../settings/settings.service'
import { isWithholdingFiled } from '../withholding/withholding-link'
import { CLOSED_STATUSES, legacyStatusOf } from './card-status'
import * as repo from './cards.repository'
import { serializeCard, serializeRow } from './cards.serializer'
import * as cards from './cards.service'
import type { CardRow, PayrollRowRecord } from './cards.types'
import { incomeTypesOfLegacySegment, legacySegmentOf, parseLegacySegment, paymentMonthOf, WAGE_INCOME_TYPES } from './cards.utils'
import {
  groupByAttrDateQuery,
  keywordQuery,
  legacyCreateBody,
  legacyDataBody,
  legacyDetailQuery,
  legacyNameBody,
  legacyNotificationBody,
  legacyPayslipBody,
  legacySummaryQuery,
} from './legacy.schema'
import * as legacy from './legacy.service'
import * as payslips from './payslips.service'

type Ctx = Context<AppEnv>

const LEGACY_KEYS = { 'wage-salary': 'wage_salary', daily: 'daily', business: 'business', 'other-labor': 'other_labor' } as const

/**
 * Legacy payroll card routes (`급여 관리`), mounted under `/api/company/:companyId/payroll`.
 *
 * They read and write the same tables as the BPO routes with `generation =
 * legacy`. Legacy requests carry no `If-Match`, so transitions use the
 * card's current version. Every route requires the `payroll_management` menu.
 */
export function legacyRoutes(deps: AppDeps): Hono<AppEnv> {
  const { db, clock, cipher } = deps
  const adapters = resolvePayrollAdapters(deps)
  const caller = (c: Ctx): cards.CardCaller => ({ actor: c.var.access.actor, userId: c.var.user.id })
  const run = <T>(c: Ctx, fn: () => T): T =>
    transaction(db, () => {
      ensurePayrollSettings(db, c.var.company.id, clock.now())
      return fn()
    })
  const cardOf = (c: Ctx): CardRow => cards.requireCard(db, c.var.company.id, parseId(c.req.param('cardId')), 'legacy')
  const summaryOf = (card: CardRow): Record<string, unknown> => legacySummary(card, repo.listRows(db, card.company_id, card.id), isWithholdingFiled(db, card.company_id, paymentMonthOf(card.payment_date)))
  const detailOf = (card: CardRow, incomeTypes?: readonly PayrollIncomeType[]): Record<string, unknown> => {
    const rows = repo.listRows(db, card.company_id, card.id, incomeTypes)
    return { ...summaryOf(card), ...groupedRows(rows, (row) => legacyRow(row, cipher)) }
  }
  const transitionRoute = (name: 'confirmInput' | 'legacyFix' | 'legacyRelease') => (c: Ctx) =>
    c.json(
      summaryOf(
        run(c, () => {
          const card = cardOf(c)
          return cards.transition(deps, card, name, caller(c), card.version)
        }),
      ),
    )

  return new Hono<AppEnv>()
    .use('/card-summary/*', requireMenu('payroll_management'))
    .use('/card-summary', requireMenu('payroll_management'))
    .use('/cards/*', requireMenu('payroll_management'))
    .use('/cards', requireMenu('payroll_management'))
    .get('/card-summary', zValidator('query', legacySummaryQuery, validationHook), (c) => {
      const year = c.req.valid('query').year
      return c.json({ results: repo.listCards(db, c.var.company.id, { generation: 'legacy', ...(year === undefined ? {} : { year }) }).map(summaryOf) })
    })
    .get('/card-summary/group-by-attr-date', zValidator('query', groupByAttrDateQuery, validationHook), (c) => {
      const query = c.req.valid('query')
      const list = repo
        .listCards(db, c.var.company.id, {
          generation: 'legacy',
          ...(query.attr_date === undefined ? {} : { attributionMonth: query.attr_date }),
          ...(query.fixed_cards_only === 'true' ? { statuses: CLOSED_STATUSES } : {}),
        })
        .filter((card) => query.status === undefined || legacyStatusOf(card.status) === query.status)
      const groups = new Map<string, CardRow[]>()
      for (const card of list) groups.set(card.attribution_month, [...(groups.get(card.attribution_month) ?? []), card])
      return c.json({
        results: [...groups].map(([month, members]) => ({
          attr_date: month,
          default_card: members.find((card) => card.kind === 'default')?.id ?? null,
          additional_count: members.filter((card) => card.kind === 'addition').length,
          cards: members.map(summaryOf),
        })),
      })
    })
    .post('/cards', zValidator('json', legacyCreateBody, validationHook), (c) => {
      const body = c.req.valid('json')
      const card = run(c, () => legacy.createLegacyCard(deps, c.var.company.id, { attributionMonth: body.attribution_month, paymentDate: body.payment_date, name: body.name }, caller(c)))
      return c.json(detailOf(card), 201)
    })
    .get('/cards/fixed-payrolls-with-keyword', zValidator('query', keywordQuery, validationHook), (c) => {
      const query = c.req.valid('query')
      const incomeTypes = incomeTypesOf(query.income_type)
      const closed = repo.listCards(db, c.var.company.id, { generation: 'legacy', statuses: CLOSED_STATUSES })
      const keyword = query.keyword?.trim() ?? ''
      const results = repo
        .listRowsOfCards(db, c.var.company.id, closed.map((card) => card.id))
        .filter((row) => (incomeTypes === undefined || incomeTypes.includes(row.income_type)) && row.name.includes(keyword))
        .map((row) => ({ card_id: row.card_id, ...legacyRow(row, cipher) }))
      return c.json({ results })
    })
    .get('/cards/employee-names', zValidator('query', keywordQuery, validationHook), (c) => {
      const query = c.req.valid('query')
      const incomeTypes = incomeTypesOf(query.income_type)
      const keyword = query.keyword?.trim() ?? ''
      const all = repo.listCards(db, c.var.company.id, { generation: 'legacy' })
      const names = new Set(
        repo
          .listRowsOfCards(db, c.var.company.id, all.map((card) => card.id))
          .filter((row) => (incomeTypes === undefined || incomeTypes.includes(row.income_type)) && row.name.includes(keyword))
          .map((row) => row.name),
      )
      return c.json({ results: [...names].sort() })
    })
    .get('/cards/:cardId', zValidator('query', legacyDetailQuery, validationHook), (c) => {
      const card = cardOf(c)
      if (c.req.valid('query').fixed_cards_only !== 'true') return c.json(detailOf(card))
      const members = repo.listCards(db, card.company_id, { generation: 'legacy', attributionMonth: card.attribution_month, statuses: CLOSED_STATUSES })
      const rows = repo.listRowsOfCards(db, card.company_id, members.map((member) => member.id))
      return c.json({ ...summaryOf(card), card_ids: members.map((member) => member.id), ...groupedRows(rows, (row) => legacyRow(row, cipher)) })
    })
    .delete('/cards/:cardId', (c) => {
      run(c, () => {
        const card = cardOf(c)
        if (card.kind !== 'addition') throw new DomainError('INVALID_TRANSITION', 'Only an additional payroll card can be deleted.')
        cards.removeCard(deps, card, caller(c))
      })
      return c.body(null, 204)
    })
    .post('/cards/:cardId/data', zValidator('json', legacyDataBody, validationHook), (c) => {
      const card = run(c, () => {
        const current = cardOf(c)
        legacy.saveLegacyData(deps, current, c.req.valid('json'), caller(c))
        return current
      })
      return c.json(detailOf(card))
    })
    .patch('/cards/:cardId/update-name', zValidator('json', legacyNameBody, validationHook), (c) =>
      c.json(summaryOf(run(c, () => cards.updateCardHeader(deps, cardOf(c), { title: c.req.valid('json').name }, caller(c))))),
    )
    .post('/cards/:cardId/calculate', transitionRoute('confirmInput'))
    .post('/cards/:cardId/extensions/fix', transitionRoute('legacyFix'))
    .post('/cards/:cardId/extensions/release', transitionRoute('legacyRelease'))
    .get('/cards/:cardId/card-status', (c) => {
      const card = cardOf(c)
      return c.json({ id: card.id, status: legacyStatusOf(card.status), card_status: card.status })
    })
    .get('/cards/:cardId/fixed-payrolls', zValidator('query', legacyDetailQuery, validationHook), (c) => {
      const card = cardOf(c)
      const incomeTypes = incomeTypesOf(c.req.valid('query').income_type)
      const members = repo.listCards(db, card.company_id, { generation: 'legacy', attributionMonth: card.attribution_month, statuses: CLOSED_STATUSES })
      const rows = repo
        .listRowsOfCards(db, card.company_id, members.map((member) => member.id))
        .filter((row) => incomeTypes === undefined || incomeTypes.includes(row.income_type))
      return c.json({ results: rows.map((row) => ({ card_id: row.card_id, ...legacyRow(row, cipher) })) })
    })
    .post('/cards/:cardId/additional-card', (c) => c.json(detailOf(run(c, () => legacy.createLegacyAdditionalCard(deps, cardOf(c), caller(c)))), 201))
    .get('/cards/:cardId/can-create-additional-card', (c) => c.json(run(c, () => legacy.additionalCardAvailability(deps, cardOf(c)))))
    .post('/cards/:cardId/refresh-wage-employees-list', (c) => {
      const result = run(c, () => {
        const card = cardOf(c)
        const change = legacy.refreshWageRoster(deps, card, caller(c))
        return { ...change, card: detailOf(card) }
      })
      return c.json(result)
    })
    .get('/cards/:cardId/inquire-wage-employees-change', (c) => c.json(legacy.wageRosterChange(deps, cardOf(c))))
    .get('/cards/:cardId/payslip', (c) => {
      const card = cardOf(c)
      const records = repo.listPayslips(db, card.id)
      return c.json({
        card: summaryOf(card),
        wage_salary: repo.listRows(db, card.company_id, card.id, WAGE_INCOME_TYPES).map((row) => ({
          ...legacyRow(row, cipher),
          payslip_email: records.get(row.id)?.email ?? row.email,
          payment_formulas: JSON.parse(records.get(row.id)?.payment_formulas ?? '{}') as Record<string, string>,
          notification_status: records.get(row.id)?.notification_status ?? null,
        })),
      })
    })
    .post('/cards/:cardId/payslip', zValidator('json', legacyPayslipBody, validationHook), (c) => {
      run(c, () => legacy.saveLegacyPayslips(deps, cardOf(c), c.req.valid('json')))
      return c.json({ saved: c.req.valid('json').wage_salary.length })
    })
    .get('/cards/:cardId/payslip/wage-salary/notifications', (c) => {
      const card = cardOf(c)
      const records = repo.listPayslips(db, card.id)
      return c.json({
        results: repo.listRows(db, card.company_id, card.id, WAGE_INCOME_TYPES).map((row) => ({
          row_id: row.id,
          name: row.name,
          status: records.get(row.id)?.notification_status ?? null,
          fail_reason: records.get(row.id)?.fail_reason ?? null,
          sent_at: records.get(row.id)?.sent_at ?? null,
        })),
      })
    })
    .post('/cards/:cardId/payslip/wage-salary/notifications', zValidator('json', legacyNotificationBody, validationHook), async (c) => {
      const results = await payslips.sendPayslips(
        deps,
        c.var.company.id,
        parseId(c.req.param('cardId')),
        'legacy',
        c.req.valid('json').row_ids,
        caller(c),
        c.var.company.name,
        adapters,
      )
      return c.json({ results: results.map((result) => ({ row_id: result.row_id, status: result.notification_status, fail_reason: result.fail_reason })) })
    })
    .post('/cards/:cardId/payslip/wage-salary/copy-payment-formulas', (c) => c.json({ results: legacy.previousPaymentFormulas(deps, cardOf(c)) }))
    .get('/cards/:cardId/copy', (c) => {
      const card = cardOf(c)
      const source = legacy.copySourceOf(deps, card)
      return c.json({ can_copy: source !== undefined && card.status === 'inputting', source_card_id: source?.id ?? null })
    })
    .post('/cards/:cardId/copy', (c) => {
      const result = run(c, () => {
        const card = cardOf(c)
        return { ...legacy.copyFromPrevious(deps, card, caller(c)), card: detailOf(card) }
      })
      return c.json(result)
    })
}

/**
 * Routes outside the company mount: `GET`/`POST /api/company/new-payroll/maintain-payroll/:companyId`.
 *
 * They authenticate and scope the company inline because `createApp` mounts
 * public routers before authentication.
 */
export function maintainPayrollRoutes(deps: AppDeps): Hono<AppEnv> {
  const path = '/api/company/new-payroll/maintain-payroll/:companyId'
  const guard = [authenticate(deps), companyScope(deps), requireMenu('payroll_management')] as const
  return new Hono<AppEnv>()
    .get(path, ...guard, (c) => c.json({ maintain: repo.findMaintainPayroll(deps.db, c.var.company.id) }))
    .post(path, ...guard, (c) => {
      transaction(deps.db, () => repo.saveMaintainPayroll(deps.db, c.var.company.id, c.var.user.id, deps.clock.now()))
      return c.json({ maintain: true })
    })
}

function legacySummary(card: CardRow, rows: readonly PayrollRowRecord[], withholdingFiled: boolean): Record<string, unknown> {
  const base = serializeCard(card, rows, { withholding_filed: withholdingFiled })
  const counts: Record<string, number> = { wage_salary: 0, daily: 0, business: 0, other_labor: 0 }
  const totals: Record<string, number> = { wage_salary: 0, daily: 0, business: 0, other_labor: 0 }
  for (const row of rows) {
    const key = LEGACY_KEYS[legacySegmentOf(row.income_type)]
    counts[key] = (counts[key] ?? 0) + 1
    totals[key] = (totals[key] ?? 0) + row.net_pay
  }
  return { ...base, name: card.title, attr_date: card.attribution_month, status: legacyStatusOf(card.status), card_status: card.status, headcount: counts, net_pay_total_by_type: totals }
}

function legacyRow(row: PayrollRowRecord, cipher: AppDeps['cipher']): Record<string, unknown> {
  return { ...serializeRow(row, cipher), income_type: legacySegmentOf(row.income_type), wage_type: row.income_type, ...legacy.legacyAmountsOf(row) }
}

function groupedRows(rows: readonly PayrollRowRecord[], serialize: (row: PayrollRowRecord) => Record<string, unknown>): Record<string, Record<string, unknown>[]> {
  const grouped: Record<string, Record<string, unknown>[]> = { wage_salary: [], daily: [], business: [], other_labor: [] }
  for (const row of rows) grouped[LEGACY_KEYS[legacySegmentOf(row.income_type)]]?.push(serialize(row))
  return grouped
}

function incomeTypesOf(value: string | undefined): PayrollIncomeType[] | undefined {
  if (value === undefined || value === '') return undefined
  const segment = parseLegacySegment(value)
  if (segment === undefined) throw notFound('Income type')
  return incomeTypesOfLegacySegment(segment)
}

function parseId(value: string | undefined): number {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) throw notFound('Payroll card')
  return id
}
