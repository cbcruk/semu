import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { AppDeps, AppEnv } from '../../app.types'
import { notFound } from '../../lib/domain-error'
import { parsePageRequest, toPage } from '../../lib/drf-pagination'
import { fileResponse, readMultipartUpload } from '../../lib/http'
import { assertAllowed, requireTaxMenu } from '../../middleware/access'
import { requireIfMatch, versionTag } from '../../middleware/if-match'
import { validationHook } from '../../middleware/validation'
import { decide } from '../access/access'
import { TAX_TYPE_MENU_CODE, TAX_TYPES } from '../access/menu-codes'
import { listFilings, listFilingsForYear } from './filings.repository'
import { calendarQuery, disputeBody, listFilingsQuery, payBody, requirementBody } from './filings.schema'
import { serializeFiling } from './filings.serializer'
import {
  attachRequirementFile,
  detachRequirementFile,
  getFilingDetail,
  readDocument,
  readRequirementFile,
  requireFilingOfType,
  setRequirementResponse,
  transitionFiling,
} from './filings.service'
import type { Actor, FilingRow, TransitionInput, TransitionName } from './filings.types'

/** Customer routes for tax filings, mounted under `/api/company/:companyId`. */
export function filingRoutes(deps: AppDeps): Hono<AppEnv> {
  const uploadLimit = bodyLimit({
    maxSize: deps.maxUploadBytes,
    onError: (c) => c.json({ detail: 'The file is too large.', code: 'PAYLOAD_TOO_LARGE' }, 413),
  })
  const clientActor = (userId: string): Actor => ({ type: 'client', id: userId })
  const respond = (filing: FilingRow): Record<string, unknown> => serializeFiling(filing, deps.clock.today())

  const transition = (name: TransitionName, input: TransitionInput, filingId: string, companyId: string, userId: string, version: number): FilingRow =>
    transitionFiling(deps, companyId, filingId, name, clientActor(userId), version, input)

  return new Hono<AppEnv>()
    .get('/tax/calendar', zValidator('query', calendarQuery, validationHook), (c) => {
      const allowed = TAX_TYPES.filter((taxType) => decide(c.var.access, TAX_TYPE_MENU_CODE[taxType]).ok)
      if (allowed.length === 0) assertAllowed(decide(c.var.access, 'tax_surtax'))
      const rows = listFilingsForYear(deps.db, c.var.company.id, allowed, c.req.valid('query').year)
      return c.json({ results: rows.map(respond) })
    })
    .get('/tax/:taxType', requireTaxMenu(), zValidator('query', listFilingsQuery, validationHook), (c) => {
      const query = c.req.valid('query')
      const page = parsePageRequest(query.limit, query.offset)
      const { rows, count } = listFilings(deps.db, c.var.company.id, c.var.taxType, query.year, page.limit, page.offset)
      return c.json(toPage(rows.map(respond), count, page, c.req.url))
    })
    .get('/tax/:taxType/:filingId', requireTaxMenu(), (c) => {
      requireFilingOfType(deps.db, c.var.company.id, c.req.param('filingId'), c.var.taxType)
      const { filing, body } = getFilingDetail(deps, c.var.company.id, c.req.param('filingId'), 'client')
      c.header('ETag', versionTag(filing.version))
      return c.json(body)
    })
    .put('/tax/:taxType/:filingId/requirements/:code', requireTaxMenu(), zValidator('json', requirementBody, validationHook), (c) => {
      requireFilingOfType(deps.db, c.var.company.id, c.req.param('filingId'), c.var.taxType)
      const body = c.req.valid('json')
      const filing = setRequirementResponse(
        deps,
        c.var.company.id,
        c.req.param('filingId'),
        c.req.param('code'),
        body.response,
        body.note ?? null,
        clientActor(c.var.user.id),
      )
      return c.json(respond(filing))
    })
    .post('/tax/:taxType/:filingId/requirements/:code/files', requireTaxMenu(), uploadLimit, async (c) => {
      requireFilingOfType(deps.db, c.var.company.id, c.req.param('filingId'), c.var.taxType)
      const { upload } = await readMultipartUpload(c)
      const filing = await attachRequirementFile(
        deps,
        c.var.company.id,
        c.req.param('filingId'),
        c.req.param('code'),
        upload,
        clientActor(c.var.user.id),
      )
      return c.json(respond(filing), 201)
    })
    .get('/tax/:taxType/:filingId/requirements/:code/files/:fileId', requireTaxMenu(), async (c) => {
      requireFilingOfType(deps.db, c.var.company.id, c.req.param('filingId'), c.var.taxType)
      const { file, data } = await readRequirementFile(deps, c.var.company.id, c.req.param('filingId'), c.req.param('code'), c.req.param('fileId'))
      return fileResponse(c, file, data)
    })
    .delete('/tax/:taxType/:filingId/requirements/:code/files/:fileId', requireTaxMenu(), (c) => {
      requireFilingOfType(deps.db, c.var.company.id, c.req.param('filingId'), c.var.taxType)
      const filing = detachRequirementFile(
        deps,
        c.var.company.id,
        c.req.param('filingId'),
        c.req.param('code'),
        c.req.param('fileId'),
        clientActor(c.var.user.id),
      )
      return c.json(respond(filing))
    })
    .post('/tax/:taxType/:filingId/submit', requireTaxMenu(), requireIfMatch(), (c) => {
      requireFilingOfType(deps.db, c.var.company.id, c.req.param('filingId'), c.var.taxType)
      return c.json(respond(transition('submit', {}, c.req.param('filingId'), c.var.company.id, c.var.user.id, c.var.expectedVersion)))
    })
    .post('/tax/:taxType/:filingId/unsubmit', requireTaxMenu(), requireIfMatch(), (c) => {
      requireFilingOfType(deps.db, c.var.company.id, c.req.param('filingId'), c.var.taxType)
      return c.json(respond(transition('unsubmit', {}, c.req.param('filingId'), c.var.company.id, c.var.user.id, c.var.expectedVersion)))
    })
    .post('/tax/:taxType/:filingId/ledger/confirm', requireTaxMenu(), requireIfMatch(), (c) => {
      requireSurtaxPath(c.var.taxType)
      requireFilingOfType(deps.db, c.var.company.id, c.req.param('filingId'), c.var.taxType)
      return c.json(respond(transition('confirmLedger', {}, c.req.param('filingId'), c.var.company.id, c.var.user.id, c.var.expectedVersion)))
    })
    .post(
      '/tax/:taxType/:filingId/ledger/dispute',
      requireTaxMenu(),
      requireIfMatch(),
      zValidator('json', disputeBody, validationHook),
      (c) => {
        requireSurtaxPath(c.var.taxType)
        requireFilingOfType(deps.db, c.var.company.id, c.req.param('filingId'), c.var.taxType)
        const { reason } = c.req.valid('json')
        return c.json(
          respond(transition('disputeLedger', { reason }, c.req.param('filingId'), c.var.company.id, c.var.user.id, c.var.expectedVersion)),
        )
      },
    )
    .post('/tax/:taxType/:filingId/pay', requireTaxMenu(), requireIfMatch(), zValidator('json', payBody, validationHook), (c) => {
      requireFilingOfType(deps.db, c.var.company.id, c.req.param('filingId'), c.var.taxType)
      const { paid_on: paidOn } = c.req.valid('json')
      return c.json(respond(transition('pay', { paidOn }, c.req.param('filingId'), c.var.company.id, c.var.user.id, c.var.expectedVersion)))
    })
    .get('/tax/:taxType/:filingId/documents/:docId', requireTaxMenu(), async (c) => {
      requireFilingOfType(deps.db, c.var.company.id, c.req.param('filingId'), c.var.taxType)
      const { file, data } = await readDocument(deps, c.var.company.id, c.req.param('filingId'), c.req.param('docId'), 'client')
      return fileResponse(c, file, data)
    })
}

function requireSurtaxPath(taxType: string): void {
  if (taxType !== 'surtax') throw notFound('Route')
}
