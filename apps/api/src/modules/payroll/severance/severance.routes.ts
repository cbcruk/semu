import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import type { AppDeps, AppEnv } from '../../../app.types'
import { transaction } from '../../../db/query'
import { invalidField, notFound } from '../../../lib/domain-error'
import { parsePageRequest, toPage } from '../../../lib/drf-pagination'
import { isPlainDate } from '../../../lib/plain-date'
import type { PlainDate } from '../../../lib/plain-date.types'
import { requireMenu } from '../../../middleware/access'
import { requireIfMatch, versionTag } from '../../../middleware/if-match'
import { validationHook } from '../../../middleware/validation'
import * as repo from './severance.repository'
import { createSettlementBody, excludeBody, settlementInputBody, settlementListQuery } from './severance.schema'
import { serializeCandidate, serializeMonthlyWage, serializeSettlement } from './severance.serializer'
import * as service from './severance.service'
import { INTERIM_REASONS } from './severance.types'

const INTERIM_REASON_LABELS: Record<string, string> = {
  home_purchase: '무주택자 본인 명의 주택 구입',
  rent_deposit: '무주택자 주거 전세금·보증금 부담',
  medical_treatment: '6개월 이상 요양',
  bankruptcy: '파산선고',
  personal_rehabilitation: '개인회생절차 개시',
  wage_peak: '임금피크제 실시',
  work_hours_reduction: '소정근로시간 단축',
  legal_work_hours_reduction: '법정 근로시간 단축',
  etc_gov_notice: '그 밖에 고용노동부장관이 정하는 사유',
}

/**
 * Severance settlement routes (퇴직금 정산), mounted under `/payroll/bpo/severance/settlements`.
 *
 * Clients may read; agency staff create and change settlements. Status
 * changes (`complete`, `reopen`, `exclude`, `include`) require `If-Match`.
 */
export function severanceRoutes(deps: AppDeps): Hono<AppEnv> {
  const { db } = deps
  const caller = (c: { var: AppEnv['Variables'] }): service.SeveranceCaller => ({ actor: c.var.access.actor, userId: c.var.user.id })
  const load = (companyId: string, raw: string): ReturnType<typeof service.requireSettlement> => service.requireSettlement(db, companyId, parseId(raw))

  return new Hono<AppEnv>()
    .use('*', requireMenu('severance_pay_settlement'))
    .get('/filter-options', (c) =>
      c.json({
        kinds: [
          { value: 'retirement', label: '퇴직 정산' },
          { value: 'interim', label: '중간 정산' },
        ],
        statuses: [
          { value: 'in_progress', label: '정산 진행' },
          { value: 'completed', label: '정산 완료' },
          { value: 'excluded', label: '정산 제외' },
        ],
        interim_reasons: INTERIM_REASONS.map((value) => ({ value, label: INTERIM_REASON_LABELS[value] ?? value })),
      }),
    )
    .get('/status-counts', zValidator('query', settlementListQuery, validationHook), (c) => {
      const query = c.req.valid('query')
      return c.json(repo.countSettlementsByStatus(db, c.var.company.id, filterOf(query)))
    })
    .get('/retirement-candidates', (c) => c.json({ results: service.retirementCandidates(deps, c.var.company.id).map(serializeCandidate) }))
    .get('/interim-candidates', (c) => {
      const raw = c.req.query('base_date')
      if (raw !== undefined && !isPlainDate(raw)) throw invalidField('base_date', 'Expected a YYYY-MM-DD date.')
      const baseDate = (raw ?? deps.clock.today()) as PlainDate
      return c.json({ results: service.interimCandidates(deps, c.var.company.id, baseDate).map(serializeCandidate) })
    })
    .get('/', zValidator('query', settlementListQuery, validationHook), (c) => {
      const query = c.req.valid('query')
      const page = parsePageRequest(query.limit, query.offset)
      const { rows, count } = repo.listSettlements(db, c.var.company.id, filterOf(query), page.limit, page.offset)
      return c.json(toPage(rows.map((row) => serializeSettlement(row)), count, page, c.req.url))
    })
    .post('/', zValidator('json', createSettlementBody, validationHook), (c) => {
      const rows = transaction(db, () => service.createSettlements(deps, c.var.company.id, c.req.valid('json'), caller(c)))
      return c.json({ results: rows.map((row) => serializeSettlement(row, repo.listMonthlyWages(db, row.id))) }, 201)
    })
    .get('/:settlementId', (c) => {
      const row = load(c.var.company.id, c.req.param('settlementId'))
      c.header('ETag', versionTag(row.version))
      return c.json(serializeSettlement(row, repo.listMonthlyWages(db, row.id)))
    })
    .delete('/:settlementId', (c) => {
      transaction(db, () => service.removeSettlement(deps, load(c.var.company.id, c.req.param('settlementId')), caller(c)))
      return c.body(null, 204)
    })
    .get('/:settlementId/monthly-wages', (c) => {
      const row = load(c.var.company.id, c.req.param('settlementId'))
      const wages = repo.listMonthlyWages(db, row.id)
      return c.json({ results: wages.map(serializeMonthlyWage), total: wages.reduce((total, wage) => total + wage.total, 0) })
    })
    .get('/:settlementId/monthly-wages/:monthId', (c) => {
      const row = load(c.var.company.id, c.req.param('settlementId'))
      const key = c.req.param('monthId')
      const wage = repo.listMonthlyWages(db, row.id).find((entry) => String(entry.id) === key || entry.month === key)
      if (wage === undefined) throw notFound('Monthly wage')
      return c.json(serializeMonthlyWage(wage))
    })
    .post('/:settlementId/temp-save', zValidator('json', settlementInputBody, validationHook), (c) => {
      const row = transaction(db, () =>
        service.saveSettlement(deps, load(c.var.company.id, c.req.param('settlementId')), c.req.valid('json'), caller(c), false, null),
      )
      return c.json(serializeSettlement(row, repo.listMonthlyWages(db, row.id)))
    })
    .post('/:settlementId/complete', requireIfMatch(), zValidator('json', settlementInputBody, validationHook), (c) => {
      const row = transaction(db, () =>
        service.saveSettlement(deps, load(c.var.company.id, c.req.param('settlementId')), c.req.valid('json'), caller(c), true, c.var.expectedVersion),
      )
      c.header('ETag', versionTag(row.version))
      return c.json(serializeSettlement(row, repo.listMonthlyWages(db, row.id)))
    })
    .post('/:settlementId/reopen', requireIfMatch(), (c) => {
      const row = transaction(db, () => service.moveSettlement(deps, load(c.var.company.id, c.req.param('settlementId')), 'reopen', caller(c), c.var.expectedVersion))
      c.header('ETag', versionTag(row.version))
      return c.json(serializeSettlement(row))
    })
    .post('/:settlementId/exclude', requireIfMatch(), zValidator('json', excludeBody, validationHook), (c) => {
      const row = transaction(db, () =>
        service.moveSettlement(deps, load(c.var.company.id, c.req.param('settlementId')), 'exclude', caller(c), c.var.expectedVersion, c.req.valid('json').reason),
      )
      c.header('ETag', versionTag(row.version))
      return c.json(serializeSettlement(row))
    })
    .post('/:settlementId/include', requireIfMatch(), (c) => {
      const row = transaction(db, () => service.moveSettlement(deps, load(c.var.company.id, c.req.param('settlementId')), 'include', caller(c), c.var.expectedVersion))
      c.header('ETag', versionTag(row.version))
      return c.json(serializeSettlement(row))
    })
}

function filterOf(query: { kind?: 'retirement' | 'interim' | undefined; status?: 'in_progress' | 'completed' | 'excluded' | undefined; search?: string | undefined }): repo.SeveranceFilter {
  return {
    ...(query.kind === undefined ? {} : { kind: query.kind }),
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.search === undefined ? {} : { search: query.search }),
  }
}

function parseId(value: string): number {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) throw notFound('Severance settlement')
  return id
}
