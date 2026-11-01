import { zValidator } from '@hono/zod-validator'
import type { MiddlewareHandler } from 'hono'
import { Hono } from 'hono'
import type { AppDeps, AppEnv } from '../../../app.types'
import { notFound } from '../../../lib/domain-error'
import { parsePageRequest, toPage } from '../../../lib/drf-pagination'
import { assertAllowed } from '../../../middleware/access'
import { validationHook } from '../../../middleware/validation'
import { decide } from '../../access/access'
import { csvResponse, resolveDateRange, toCsv } from '../bookkeeping.utils'
import { type EvidenceListQuery, evidenceBulkBody, evidenceListQuery, evidencePatchBody, sideParam } from './evidence.schema'
import { bulkClassifyEvidence, exportEvidence, getEvidence, listEvidence, patchEvidence } from './evidence.service'
import type { EvidenceFilter, EvidenceSide } from './evidence.types'
import { SOURCE_ALIASES } from './evidence.utils'

const SIDE_LABEL: Record<EvidenceSide, string> = { sales: '매출', purchase: '매입' }

/** Sales and purchase evidence routes, mounted under `/api/company/:companyId`. */
export function evidenceRoutes(deps: AppDeps): Hono<AppEnv> {
  const filterOf = (query: EvidenceListQuery): EvidenceFilter => ({
    ...resolveDateRange(query.start_date, query.end_date, deps.clock.today()),
    sources: (query.source ?? []).map((source) => SOURCE_ALIASES[source] ?? source),
    classification: query.classification_status,
    accountTitleIds: query.account_title_id ?? [],
    docType: query.doc_type,
    kind: query.kind,
    partnerId: query.partner_id,
    search: query.search,
  })
  return new Hono<AppEnv>()
    .get('/evidence/:side', requireEvidenceMenu(), zValidator('query', evidenceListQuery, validationHook), (c) => {
      const query = c.req.valid('query')
      const page = parsePageRequest(query.limit, query.offset)
      const result = listEvidence(deps.db, c.var.company.id, sideOf(c.req.param('side')), filterOf(query), query.sort ?? '-written_on', page)
      return c.json({ ...toPage(result.rows, result.count, page, c.req.url), counts: result.counts })
    })
    .get('/evidence/:side/export', requireEvidenceMenu(), zValidator('query', evidenceListQuery, validationHook), (c) => {
      const side = sideOf(c.req.param('side'))
      const query = c.req.valid('query')
      const filter = filterOf(query)
      const rows = exportEvidence(deps.db, c.var.company.id, side, filter, query.sort ?? '-written_on')
      const csv = toCsv([
        ['작성일자', '발급일자', '증빙', '유형', '종류', '거래처', '사업자등록번호', '품목', '합계금액', '공급가액', '세액', '분류', '메모'],
        ...rows.map((row) => [
          row.written_on,
          row.issued_on,
          row.source,
          row.doc_type,
          row.kind,
          row.partner_name ?? row.counterparty_name,
          row.counterparty_business_number,
          row.item_summary,
          row.total_amount,
          row.supply_amount,
          row.vat_amount,
          row.account_title_name,
          row.memo,
        ]),
      ])
      return csvResponse(c, `${SIDE_LABEL[side]}증빙_${filter.start}_${filter.end}.csv`, csv)
    })
    .post('/evidence/:side/bulk-classify', requireEvidenceMenu(), zValidator('json', evidenceBulkBody, validationHook), (c) =>
      c.json(bulkClassifyEvidence(deps, c.var.company.id, sideOf(c.req.param('side')), c.req.valid('json'))),
    )
    .get('/evidence/:side/:id', requireEvidenceMenu(), (c) => c.json(getEvidence(deps.db, c.var.company.id, sideOf(c.req.param('side')), c.req.param('id'))))
    .patch('/evidence/:side/:id', requireEvidenceMenu(), zValidator('json', evidencePatchBody, validationHook), (c) =>
      c.json(patchEvidence(deps, c.var.company.id, sideOf(c.req.param('side')), c.req.param('id'), c.req.valid('json'))),
    )
}

function sideOf(value: string | undefined): EvidenceSide {
  const parsed = sideParam.safeParse(value)
  if (!parsed.success) throw notFound('Route')
  return parsed.data
}

function requireEvidenceMenu(): MiddlewareHandler<AppEnv> {
  return async (c, next): Promise<void> => {
    const side = sideOf(c.req.param('side'))
    assertAllowed(decide(c.var.access, side === 'sales' ? 'bookkeeping_sales_evidence' : 'bookkeeping_purchase_evidence'))
    await next()
  }
}
