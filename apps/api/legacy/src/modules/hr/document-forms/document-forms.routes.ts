import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../../../app.types'
import { parsePageRequest, toPage } from '../../../lib/drf-pagination'
import { authenticate } from '../../../middleware/auth'
import { validationHook } from '../../../middleware/validation'
import type { HrContext } from '../shared/hr-context.types'
import { DOCUMENT_FORMS } from './document-forms.catalog'
import type { DocumentFormType } from './document-forms.types'

const FORM_TYPES: readonly DocumentFormType[] = ['인사', '경리', '부동산', '주식', '이사회', '일반계약']

const formQuery = z.object({
  type: z.string().optional(),
  search: z.string().trim().max(100).optional(),
  limit: z.string().optional(),
  offset: z.string().optional(),
})

/**
 * Routes of the global 서식 모음 catalog under `/nexus-api/document-form`.
 *
 * The catalog is not company-scoped and is open to every signed-in user
 * regardless of subscription, so the routes authenticate themselves: they
 * live outside the `/api/*` prefix the app authenticates.
 */
export function documentFormRoutes({ deps }: HrContext): Hono<AppEnv> {
  const auth = authenticate(deps)
  const matching = (search: string | undefined): typeof DOCUMENT_FORMS => {
    const needle = search?.toLowerCase() ?? ''
    return needle === '' ? DOCUMENT_FORMS : DOCUMENT_FORMS.filter((form) => form.title.toLowerCase().includes(needle) || form.description.toLowerCase().includes(needle))
  }

  return new Hono<AppEnv>()
    .get('/nexus-api/document-form', auth, zValidator('query', formQuery, validationHook), (c) => {
      const query = c.req.valid('query')
      const type = query.type === undefined || query.type === '' ? null : query.type
      const forms = matching(query.search).filter((form) => type === null || form.type === type)
      const page = parsePageRequest(query.limit, query.offset)
      return c.json(toPage(forms.slice(page.offset, page.offset + page.limit), forms.length, page, c.req.url))
    })
    .get('/nexus-api/document-form/type-count', auth, zValidator('query', formQuery, validationHook), (c) => {
      const forms = matching(c.req.valid('query').search)
      return c.json(FORM_TYPES.map((type) => ({ type, count: forms.filter((form) => form.type === type).length })))
    })
}
