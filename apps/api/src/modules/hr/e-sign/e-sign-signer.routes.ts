import { zValidator } from '@hono/zod-validator'
import { type Context, Hono } from 'hono'
import type { AppEnv } from '../../../app.types'
import { fileResponse } from '../../../lib/http'
import { validationHook } from '../../../middleware/validation'
import { parseId } from '../employees/employee-guard'
import type { HrContext } from '../shared/hr-context.types'
import { readHrUpload } from '../shared/hr-files'
import {
  addSignerSeal,
  completeSigning,
  readSignedPdf,
  readSignerSeal,
  requireSignerSession,
  resolveSigningToken,
  signerDocuments,
  signerLeavingReasons,
  signerSeals,
  signerSummary,
  verifySigner,
} from './e-sign-signer.service'
import { completeBody, verifyBody } from './e-sign.schema'
import type { ESignRequestAggregate, RequestOrigin } from './e-sign.types'
import { clientIp } from './e-sign.utils'

const BASE = '/api/employment/e-sign/:signingToken'

/** Header that carries the signer session issued by `verify`. */
export const SIGNER_SESSION_HEADER = 'X-ESign-Session'

/**
 * Public routes of the worker's signing link, mounted before authentication.
 *
 * The token in the path identifies the request; every route after `verify`
 * also needs the session from `X-ESign-Session`.
 */
export function eSignSignerRoutes(context: HrContext): Hono<AppEnv> {
  const withSession = async (c: Context<AppEnv>, allowCompleted = false): Promise<ESignRequestAggregate> => {
    const aggregate = await resolveSigningToken(context, c.req.param('signingToken') ?? '')
    requireSignerSession(context, aggregate, c.req.header(SIGNER_SESSION_HEADER), allowCompleted)
    return aggregate
  }
  return new Hono<AppEnv>()
    .get(`${BASE}/summary`, async (c) => c.json(signerSummary(context.deps.db, await resolveSigningToken(context, c.req.param('signingToken')))))
    .post(`${BASE}/verify`, zValidator('json', verifyBody, validationHook), async (c) => {
      const aggregate = await resolveSigningToken(context, c.req.param('signingToken'))
      return c.json(await verifySigner(context, aggregate, c.req.valid('json'), originOf(c)))
    })
    .get(`${BASE}/documents`, async (c) => c.json(signerDocuments(context.deps.db, await withSession(c))))
    .get(`${BASE}/seals`, async (c) => c.json(signerSeals(context.deps.db, await withSession(c))))
    .post(`${BASE}/seals`, async (c) => {
      const aggregate = await withSession(c)
      return c.json(await addSignerSeal(context, aggregate, await readHrUpload(c, ['image', 'file']), originOf(c)), 201)
    })
    .get(`${BASE}/seals/:sealId{[0-9]+}/image`, async (c) => {
      const { file, data } = await readSignerSeal(context, await withSession(c), parseId(c.req.param('sealId'), 'Seal'))
      return fileResponse(c, file, data)
    })
    .get(`${BASE}/leaving-reasons`, async (c) => {
      await withSession(c)
      return c.json(signerLeavingReasons())
    })
    .post(`${BASE}/complete`, zValidator('json', completeBody, validationHook), async (c) => {
      const aggregate = await withSession(c)
      return c.json(await completeSigning(context, aggregate, c.req.valid('json'), originOf(c)))
    })
    .get(`${BASE}/download`, async (c) => {
      const { file, data } = await readSignedPdf(context, await withSession(c, true))
      return fileResponse(c, file, data)
    })
}

function originOf(c: Context<AppEnv>): RequestOrigin {
  return { ip: clientIp(c.req.header('x-forwarded-for')), userAgent: c.req.header('user-agent') ?? null }
}
