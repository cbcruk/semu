import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import type { AppEnv } from '../../../app.types'
import { notFound } from '../../../lib/domain-error'
import { fileResponse } from '../../../lib/http'
import { requireMenu } from '../../../middleware/access'
import { validationHook } from '../../../middleware/validation'
import { DOCUMENT_CATEGORIES } from '../documents/documents.repository'
import { parseId } from '../employees/employee-guard'
import { requireAnyMenu } from '../shared/hr-access'
import type { HrContext } from '../shared/hr-context.types'
import { readHrUpload } from '../shared/hr-files'
import { addSeal, findTemplate, getNotiRecipients, listSeals, listTemplates, patchTemplate, putNotiRecipients, readSealImage, removeSeal } from './e-sign-settings.service'
import { notiRecipientsBody, templateListQuery, templatePatchBody } from './e-sign.schema'
import { serializeNotiRecipient, serializeSeal, serializeTemplate } from './e-sign.serializer'

const SETTINGS_READERS = requireAnyMenu(['settings_e_sign', 'employment_e_sign', 'employment_certificate'])

/** Company routes of 전자서명·제증명 관리: document categories, seals, notification recipients and templates. */
export function eSignSettingsRoutes(context: HrContext): Hono<AppEnv> {
  const { deps } = context
  return new Hono<AppEnv>()
    .get('/employment/settings/document-categories', SETTINGS_READERS, (c) => c.json(DOCUMENT_CATEGORIES))
    .get('/employment/settings/company-seals', SETTINGS_READERS, (c) => c.json(listSeals(deps.db, c.var.company.id).map(serializeSeal)))
    .post('/employment/settings/company-seals', requireMenu('settings_e_sign'), async (c) => {
      const upload = await readHrUpload(c, ['image', 'file'])
      return c.json(serializeSeal(await addSeal(deps, c.var.company.id, upload, c.var.user.id)), 201)
    })
    .get('/employment/settings/company-seals/:sealId{[0-9]+}/image', SETTINGS_READERS, async (c) => {
      const { file, data } = await readSealImage(deps, c.var.company.id, parseId(c.req.param('sealId'), 'Seal'))
      return fileResponse(c, file, data)
    })
    .delete('/employment/settings/company-seals/:sealId{[0-9]+}', requireMenu('settings_e_sign'), (c) => {
      removeSeal(deps, c.var.company.id, parseId(c.req.param('sealId'), 'Seal'))
      return c.body(null, 204)
    })
    .get('/employment/settings/e-sign-noti-recipients', requireMenu('employment_e_sign'), (c) =>
      c.json(getNotiRecipients(deps.db, c.var.company.id).map(serializeNotiRecipient)),
    )
    .put('/employment/settings/e-sign-noti-recipients', requireMenu('employment_e_sign'), zValidator('json', notiRecipientsBody, validationHook), (c) =>
      c.json(putNotiRecipients(deps.db, c.var.company.id, c.req.valid('json')).map(serializeNotiRecipient)),
    )
    .get('/employment/settings/e-sign-templates', SETTINGS_READERS, zValidator('query', templateListQuery, validationHook), (c) => {
      const query = c.req.valid('query')
      const templates = listTemplates(deps.db, c.var.company.id, {
        search: query.search,
        category: query.category,
        isActive: query.is_active,
        isCertificate: query.is_certificate,
      })
      return c.json({ count: templates.length, next: null, previous: null, results: templates.map((template) => serializeTemplate(template, false)) })
    })
    .get('/employment/settings/e-sign-templates/:templateId{[0-9]+}', SETTINGS_READERS, (c) => {
      const template = findTemplate(deps.db, c.var.company.id, parseId(c.req.param('templateId'), 'Template'))
      if (template === undefined) throw notFound('Template')
      return c.json(serializeTemplate(template, true))
    })
    .patch(
      '/employment/settings/e-sign-templates/:templateId{[0-9]+}',
      requireMenu('settings_e_sign'),
      zValidator('json', templatePatchBody, validationHook),
      (c) => {
        const template = patchTemplate(deps, c.var.company.id, parseId(c.req.param('templateId'), 'Template'), c.req.valid('json'), c.var.user.id)
        return c.json(serializeTemplate(template, true))
      },
    )
}
