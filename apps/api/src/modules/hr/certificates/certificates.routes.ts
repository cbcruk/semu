import { zValidator } from '@hono/zod-validator'
import { type Context, Hono } from 'hono'
import type { AppEnv } from '../../../app.types'
import { parsePageRequest, toPage } from '../../../lib/drf-pagination'
import { fileResponse } from '../../../lib/http'
import { requireMenu } from '../../../middleware/access'
import { requireIfMatch, versionTag } from '../../../middleware/if-match'
import { validationHook } from '../../../middleware/validation'
import { clientIp } from '../e-sign/e-sign.utils'
import { parseId } from '../employees/employee-guard'
import type { HrContext } from '../shared/hr-context.types'
import { certificateListQuery, certificateVerifyBody, downloadBody, issueBody, sendCertificateBody } from './certificates.schema'
import { serializeCertificate } from './certificates.serializer'
import {
  certificateCounts,
  certificateSummary,
  downloadCertificates,
  issueCertificate,
  listCertificatePage,
  readCertificateForRecipient,
  removeCertificate,
  requireCertificate,
  resolveCertificateToken,
  sendCertificate,
  verifyCertificateRecipient,
} from './certificates.service'
import type { CertificateFilter, CertificateRow } from './certificates.types'
import { parseCertificateStatuses } from './certificates.utils'

const LIST = '/employment/certificates'
const ITEM = `${LIST}/:certificateId{[0-9]+}`
const PUBLIC = '/api/employment/certificates/:signingToken'

/** Header that carries the recipient session issued by the public `verify`. */
export const CERTIFICATE_SESSION_HEADER = 'X-Certificate-Session'

/** Company routes of 증명서 발급: issuing, sending, listing and downloading certificates. */
export function certificateRoutes(context: HrContext): Hono<AppEnv> {
  const { db } = context.deps
  const respond = (c: Context<AppEnv>, certificate: CertificateRow, status: 200 | 201 = 200): Response => {
    c.header('ETag', versionTag(certificate.version))
    return c.json(serializeCertificate(certificate), status)
  }
  const certificateId = (c: Context<AppEnv>): number => parseId(c.req.param('certificateId'), 'Certificate')
  return new Hono<AppEnv>()
    .use(`${LIST}/*`, requireMenu('employment_certificate'))
    .use(LIST, requireMenu('employment_certificate'))
    .get(LIST, zValidator('query', certificateListQuery, validationHook), (c) => {
      const query = c.req.valid('query')
      const page = parsePageRequest(query.limit, query.offset)
      const { rows, count } = listCertificatePage(db, c.var.company.id, toFilter(query), page.limit, page.offset)
      return c.json(toPage(rows.map(serializeCertificate), count, page, c.req.url))
    })
    .post(LIST, zValidator('json', issueBody, validationHook), async (c) => respond(c, await issueCertificate(context, c.var.company.id, c.req.valid('json'), c.var.user.id), 201))
    .get(`${LIST}/count-by-status`, zValidator('query', certificateListQuery, validationHook), (c) => c.json(certificateCounts(db, c.var.company.id, toFilter(c.req.valid('query')))))
    .post(`${LIST}/download`, zValidator('json', downloadBody, validationHook), async (c) => {
      const download = await downloadCertificates(context, c.var.company.id, c.req.valid('json').ids)
      return fileResponse(c, { original_name: download.name, mime_type: download.mimeType }, download.data)
    })
    .get(ITEM, (c) => respond(c, requireCertificate(db, c.var.company.id, certificateId(c))))
    .get(`${ITEM}/file`, async (c) => {
      const download = await downloadCertificates(context, c.var.company.id, [certificateId(c)])
      return fileResponse(c, { original_name: download.name, mime_type: download.mimeType }, download.data)
    })
    .delete(ITEM, (c) => {
      removeCertificate(db, c.var.company.id, certificateId(c))
      return c.body(null, 204)
    })
    .post(`${ITEM}/send`, requireIfMatch(), zValidator('json', sendCertificateBody, validationHook), async (c) =>
      respond(c, await sendCertificate(context, c.var.company.id, certificateId(c), c.req.valid('json'), c.var.expectedVersion)),
    )
}

/** Public routes of the certificate link sent to the employee, mounted before authentication. */
export function certificateSignerRoutes(context: HrContext): Hono<AppEnv> {
  const resolve = (c: Context<AppEnv>): CertificateRow => resolveCertificateToken(context.deps.db, c.req.param('signingToken') ?? '')
  return new Hono<AppEnv>()
    .get(`${PUBLIC}/summary`, (c) => c.json(certificateSummary(context, resolve(c))))
    .post(`${PUBLIC}/verify`, zValidator('json', certificateVerifyBody, validationHook), async (c) => {
      const origin = { ip: clientIp(c.req.header('x-forwarded-for')), userAgent: c.req.header('user-agent') ?? null }
      return c.json(await verifyCertificateRecipient(context, resolve(c), c.req.valid('json'), origin))
    })
    .get(`${PUBLIC}/download`, async (c) => {
      const { file, data } = await readCertificateForRecipient(context, resolve(c), c.req.header(CERTIFICATE_SESSION_HEADER))
      return fileResponse(c, file, data)
    })
}

function toFilter(query: { status?: string | undefined; search?: string | undefined; employee_id?: number | undefined }): CertificateFilter {
  const search = query.search?.trim() ?? ''
  return { statuses: parseCertificateStatuses(query.status), search: search === '' ? null : search, employeeId: query.employee_id ?? null }
}
