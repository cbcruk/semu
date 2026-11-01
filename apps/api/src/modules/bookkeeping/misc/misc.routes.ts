import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import type { AppDeps, AppEnv } from '../../../app.types'
import { fileResponse } from '../../../lib/http'
import { requireMenu } from '../../../middleware/access'
import { validationHook } from '../../../middleware/validation'
import { shareCompanyBody, uploadUrlQuery } from './misc.schema'
import { homeSsbMeta, issueUploadUrl, listBusinessTypes, readAttachment, recentShareHistory, refreshBusinessTypes, shareCompanyInfo } from './misc.service'

/** Company routes for home meta, share histories, attachments and business types. */
export function miscRoutes(deps: AppDeps): Hono<AppEnv> {
  const partners = requireMenu('bookkeeping_partners')
  return new Hono<AppEnv>()
    .get('/home/ssb/meta', (c) => c.json(homeSsbMeta(deps, c.var.company.id)))
    .get('/attachments/get-upload-url', partners, zValidator('query', uploadUrlQuery, validationHook), (c) =>
      c.json(issueUploadUrl(deps, c.var.company.id, c.var.user.id, c.req.valid('query').file_name, new URL(c.req.url).origin)),
    )
    .get('/attachments/:fileId', partners, async (c) => {
      const { file, data } = await readAttachment(deps, c.var.company.id, c.req.param('fileId'))
      return fileResponse(c, file, data)
    })
    .get('/share-histories/recent', partners, (c) => c.json(recentShareHistory(deps.db, c.var.company.id)))
    .post('/partner/share-company/send', partners, zValidator('json', shareCompanyBody, validationHook), (c) =>
      c.json(shareCompanyInfo(deps, c.var.company.id, c.var.user.id, c.req.valid('json')), 201),
    )
    .get('/get-business_types', (c) => c.json(listBusinessTypes(deps.db, c.var.company.id)))
    .post('/update-business_types', async (c) => c.json(await refreshBusinessTypes(deps, c.var.company)))
}
