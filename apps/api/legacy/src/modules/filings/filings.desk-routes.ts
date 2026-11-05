import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { AppDeps, AppEnv, AuthUser } from '../../app.types'
import { notFound } from '../../lib/domain-error'
import { parsePageRequest, toPage } from '../../lib/drf-pagination'
import { fileResponse, readMultipartUpload } from '../../lib/http'
import { assignedCompanyIds, requireAgency } from '../../middleware/agency-scope'
import { requireIfMatch, versionTag } from '../../middleware/if-match'
import { toValidationError, validationHook } from '../../middleware/validation'
import { findFilingById, listQueueFilings } from './filings.repository'
import { cancelBody, documentFields, fileBody, noticeFields, queueQuery, rejectBody, requestBody } from './filings.schema'
import { serializeFiling } from './filings.serializer'
import {
  getFilingDetail,
  readDocument,
  readRequirementFile,
  recordNotice,
  transitionFiling,
  uploadAgencyDocument,
  uploadLedger,
} from './filings.service'
import type { Actor, FilingRow, TransitionInput, TransitionName } from './filings.types'

/** Agency staff routes, mounted under `/api/desk`. */
export function deskFilingRoutes(deps: AppDeps): Hono<AppEnv> {
  const uploadLimit = bodyLimit({
    maxSize: deps.maxUploadBytes,
    onError: (c) => c.json({ detail: 'The file is too large.', code: 'PAYLOAD_TOO_LARGE' }, 413),
  })
  const agencyActor = (user: AuthUser): Actor => ({ type: 'agency', id: user.id })
  const respond = (filing: FilingRow): Record<string, unknown> => serializeFiling(filing, deps.clock.today())
  const scopedFiling = (user: AuthUser, filingId: string): FilingRow => {
    const filing = findFilingById(deps.db, filingId)
    if (filing === undefined || !assignedCompanyIds(deps.db, user).includes(filing.company_id)) throw notFound('Filing')
    return filing
  }
  const transition = (user: AuthUser, filingId: string, name: TransitionName, version: number, input: TransitionInput = {}): FilingRow => {
    const filing = scopedFiling(user, filingId)
    return transitionFiling(deps, filing.company_id, filing.id, name, agencyActor(user), version, input)
  }

  return new Hono<AppEnv>()
    .use('*', requireAgency())
    .get('/filings', zValidator('query', queueQuery, validationHook), (c) => {
      const query = c.req.valid('query')
      const page = parsePageRequest(query.limit, query.offset)
      const companyIds = assignedCompanyIds(deps.db, c.var.user)
      const { rows, count } = listQueueFilings(deps.db, companyIds, query.status, query.due_before, page.limit, page.offset)
      return c.json(toPage(rows.map(respond), count, page, c.req.url))
    })
    .get('/filings/:filingId', (c) => {
      const filing = scopedFiling(c.var.user, c.req.param('filingId'))
      const { body } = getFilingDetail(deps, filing.company_id, filing.id, 'agency')
      c.header('ETag', versionTag(filing.version))
      return c.json(body)
    })
    .get('/filings/:filingId/files/:fileId', async (c) => {
      const filing = scopedFiling(c.var.user, c.req.param('filingId'))
      const { file, data } = await readRequirementFile(deps, filing.company_id, filing.id, null, c.req.param('fileId'))
      return fileResponse(c, file, data)
    })
    .get('/filings/:filingId/documents/:docId', async (c) => {
      const filing = scopedFiling(c.var.user, c.req.param('filingId'))
      const { file, data } = await readDocument(deps, filing.company_id, filing.id, c.req.param('docId'), 'agency')
      return fileResponse(c, file, data)
    })
    .post('/filings/:filingId/request', requireIfMatch(), zValidator('json', requestBody, validationHook), (c) => {
      const body = c.req.valid('json')
      const input: TransitionInput = { submitDue: body.submit_due, ...(body.message === undefined ? {} : { message: body.message }) }
      return c.json(respond(transition(c.var.user, c.req.param('filingId'), 'request', c.var.expectedVersion, input)))
    })
    .post('/filings/:filingId/start-review', requireIfMatch(), (c) =>
      c.json(respond(transition(c.var.user, c.req.param('filingId'), 'startReview', c.var.expectedVersion))),
    )
    .post('/filings/:filingId/reject', requireIfMatch(), zValidator('json', rejectBody, validationHook), (c) => {
      const body = c.req.valid('json')
      return c.json(
        respond(transition(c.var.user, c.req.param('filingId'), 'reject', c.var.expectedVersion, { reason: body.reason, submitDue: body.submit_due })),
      )
    })
    .post('/filings/:filingId/start-preparing', requireIfMatch(), (c) =>
      c.json(respond(transition(c.var.user, c.req.param('filingId'), 'startPreparing', c.var.expectedVersion))),
    )
    .post('/filings/:filingId/file', requireIfMatch(), zValidator('json', fileBody, validationHook), (c) => {
      const body = c.req.valid('json')
      const input: TransitionInput = {
        payableAmount: body.payable_amount,
        ...(body.payment_due === undefined ? {} : { paymentDue: body.payment_due }),
      }
      return c.json(respond(transition(c.var.user, c.req.param('filingId'), 'file', c.var.expectedVersion, input)))
    })
    .post('/filings/:filingId/close', requireIfMatch(), (c) =>
      c.json(respond(transition(c.var.user, c.req.param('filingId'), 'close', c.var.expectedVersion))),
    )
    .post('/filings/:filingId/cancel', requireIfMatch(), zValidator('json', cancelBody, validationHook), (c) => {
      const { reason } = c.req.valid('json')
      return c.json(respond(transition(c.var.user, c.req.param('filingId'), 'cancel', c.var.expectedVersion, { reason })))
    })
    .post('/filings/:filingId/ledger', requireIfMatch(), uploadLimit, async (c) => {
      const filing = scopedFiling(c.var.user, c.req.param('filingId'))
      const { upload } = await readMultipartUpload(c)
      const updated = await uploadLedger(deps, filing.company_id, filing.id, upload, agencyActor(c.var.user), c.var.expectedVersion)
      return c.json(respond(updated), 201)
    })
    .post('/filings/:filingId/documents', uploadLimit, async (c) => {
      const filing = scopedFiling(c.var.user, c.req.param('filingId'))
      const { upload, fields } = await readMultipartUpload(c)
      const parsed = documentFields.safeParse(fields)
      if (!parsed.success) throw toValidationError(parsed.error.issues)
      const updated = await uploadAgencyDocument(deps, filing.company_id, filing.id, parsed.data.doc_type, upload, agencyActor(c.var.user))
      return c.json(respond(updated), 201)
    })
    .post('/filings/:filingId/record-notice', requireIfMatch(), uploadLimit, async (c) => {
      const filing = scopedFiling(c.var.user, c.req.param('filingId'))
      const { upload, fields } = await readMultipartUpload(c)
      const parsed = noticeFields.safeParse(fields)
      if (!parsed.success) throw toValidationError(parsed.error.issues)
      const updated = await recordNotice(deps, filing.company_id, filing.id, upload, agencyActor(c.var.user), c.var.expectedVersion, {
        payableAmount: parsed.data.payable_amount,
        paymentDue: parsed.data.payment_due,
      })
      return c.json(respond(updated), 201)
    })
}
