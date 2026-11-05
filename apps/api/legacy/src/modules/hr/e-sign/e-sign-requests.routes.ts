import { zValidator } from '@hono/zod-validator'
import { type Context, Hono } from 'hono'
import type { AppEnv } from '../../../app.types'
import { DomainError } from '../../../lib/domain-error'
import { parsePageRequest, toPage } from '../../../lib/drf-pagination'
import { fileResponse } from '../../../lib/http'
import { requireMenu } from '../../../middleware/access'
import { requireIfMatch, versionTag } from '../../../middleware/if-match'
import { validationHook } from '../../../middleware/validation'
import { parseId } from '../employees/employee-guard'
import type { HrContext } from '../shared/hr-context.types'
import { findEmployeeDepartmentName } from './e-sign-requests.repository'
import {
  cancelESignRequest,
  createESignRequest,
  deleteESignRequest,
  getESignRequest,
  listESignRequests,
  patchESignRequest,
  readESignResult,
  revertESignRequestToDraft,
  sendESignRequest,
  voidESignRequest,
} from './e-sign-requests.service'
import { findUserEmail } from './e-sign-settings.repository'
import { requestCreateBody, requestListQuery, requestPatchBody, sendBody } from './e-sign.schema'
import { serializeRequest } from './e-sign.serializer'
import type { ESignRequestAggregate } from './e-sign.types'
import { parseRequestStatuses } from './e-sign.utils'

const ITEM = '/employment/e-sign-requests/:requestId{[0-9]+}'

/** Company routes of 전자서명: the request list, drafts, sending and the status actions. */
export function eSignRequestRoutes(context: HrContext): Hono<AppEnv> {
  const { db } = context.deps
  const respond = (c: Context<AppEnv>, aggregate: ESignRequestAggregate, status: 200 | 201 = 200): Response => {
    c.header('ETag', versionTag(aggregate.request.version))
    return c.json(serialize(aggregate), status)
  }
  const serialize = (aggregate: ESignRequestAggregate): Record<string, unknown> =>
    serializeRequest(aggregate, {
      departmentName: findEmployeeDepartmentName(db, aggregate.request.company_id, aggregate.recipient.employee_id),
      createdByEmail: findUserEmail(db, aggregate.request.created_by),
    })
  const requestId = (c: Context<AppEnv>): number => parseId(c.req.param('requestId'), 'E-sign request')
  return new Hono<AppEnv>()
    .use('/employment/e-sign-requests/*', requireMenu('employment_e_sign'))
    .use('/employment/e-sign-requests', requireMenu('employment_e_sign'))
    .get('/employment/e-sign-requests', zValidator('query', requestListQuery, validationHook), async (c) => {
      const query = c.req.valid('query')
      const page = parsePageRequest(query.limit, query.offset)
      const { rows, count } = await listESignRequests(
        context,
        c.var.company.id,
        {
          dateType: query.date_type ?? 'requested_at',
          startDate: query.start_date ?? null,
          endDate: query.end_date ?? null,
          statuses: parseRequestStatuses(query.status),
          category: blankToNull(query.category),
          employeeName: blankToNull(query.employee_name),
          search: blankToNull(query.search),
        },
        page.limit,
        page.offset,
      )
      return c.json(toPage(rows.map(serialize), count, page, c.req.url))
    })
    .post('/employment/e-sign-requests', zValidator('json', requestCreateBody, validationHook), async (c) =>
      respond(c, await createESignRequest(context, c.var.company.id, c.req.valid('json'), c.var.user.id), 201),
    )
    .get(ITEM, async (c) => respond(c, await getESignRequest(context, c.var.company.id, requestId(c))))
    .patch(ITEM, zValidator('json', requestPatchBody, validationHook), async (c) => {
      const body = c.req.valid('json')
      const expected = body.send === true ? requiredVersion(c.req.header('If-Match')) : null
      return respond(c, await patchESignRequest(context, c.var.company.id, requestId(c), body, c.var.user.id, expected))
    })
    .delete(ITEM, (c) => {
      deleteESignRequest(context, c.var.company.id, requestId(c))
      return c.body(null, 204)
    })
    .post(`${ITEM}/send`, requireIfMatch(), zValidator('json', sendBody, validationHook), async (c) => {
      const body = c.req.valid('json')
      return respond(c, await sendESignRequest(context, c.var.company.id, requestId(c), c.var.user.id, c.var.expectedVersion, body?.due_date ?? null))
    })
    .post(`${ITEM}/cancel`, requireIfMatch(), (c) => respond(c, cancelESignRequest(context, c.var.company.id, requestId(c), c.var.user.id, c.var.expectedVersion)))
    .post(`${ITEM}/void`, requireIfMatch(), (c) => respond(c, voidESignRequest(context, c.var.company.id, requestId(c), c.var.user.id, c.var.expectedVersion)))
    .post(`${ITEM}/revert-to-draft`, requireIfMatch(), (c) =>
      respond(c, revertESignRequestToDraft(context, c.var.company.id, requestId(c), c.var.user.id, c.var.expectedVersion)),
    )
    .get(`${ITEM}/download`, async (c) => {
      const { file, data } = await readESignResult(context, c.var.company.id, requestId(c))
      return fileResponse(c, file, data)
    })
}

function requiredVersion(header: string | undefined): number {
  if (header === undefined) throw new DomainError('PRECONDITION_REQUIRED', 'Send If-Match with the request version to send it.')
  const match = /^(?:W\/)?"?(\d+)"?$/.exec(header.trim())
  if (match === null) throw new DomainError('VERSION_CONFLICT', 'If-Match must carry a version such as "3".')
  return Number(match[1])
}

function blankToNull(value: string | undefined): string | null {
  return value === undefined || value.trim() === '' ? null : value.trim()
}
