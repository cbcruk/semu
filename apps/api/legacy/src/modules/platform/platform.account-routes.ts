import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { AppEnv } from '../../app.types'
import { invalidField, notFound } from '../../lib/domain-error'
import { fileResponse, readMultipartUpload } from '../../lib/http'
import { requireMenu } from '../../middleware/access'
import { companyScope } from '../../middleware/company-scope'
import { validationHook } from '../../middleware/validation'
import { loadAccessContext } from '../access/access-directory'
import { findCompany } from '../companies/companies.repository'
import { getMe, registerCompanyForUser, serializeProfile } from './accounts/accounts.service'
import { findUser } from './accounts/users.repository'
import { changeOwnPassword, issueCompanyJwt } from './auth/auth.service'
import { clearSessionCookies } from './auth/session-cookies'
import { revokeSession } from './auth/sessions.repository'
import {
  attachmentForms,
  getAttachment,
  getCompanyContract,
  isAttachmentName,
  putAttachment,
  readAttachment,
  type AttachmentName,
} from './company-profile/company-documents.service'
import { getCompanyDetail, updateCompanySettings } from './company-profile/company-profile.service'
import { listTemplates } from './company-users/company-users.service'
import { permissionCatalog } from './company-users/menu-catalog'
import { registerCompanyByInvitation } from './contracts/contracts.service'
import { checkChatChannelToken, connectChatChannel } from './external/external.service'
import { listPendingInvitationsForEmail } from './invitations/invitations.repository'
import { effectiveStatus } from './invitations/invitations.service'
import { clientOf, requireCompanyAdmin } from './platform.middleware'
import {
  attachmentQuery,
  chatChannelBody,
  companyBody,
  companySettingsBody,
  invitationCompanyBody,
  jwtBody,
  passwordBody,
  purposeQuery,
  termAgreementsBody,
  tokenQuery,
} from './platform.schema'
import type { PlatformDeps } from './platform.types'
import { listTermAgreements, recordAgreements } from './terms/terms.service'

/**
 * Platform routes for signed-in users outside a company path: the profile,
 * company JWT, terms, catalog of permission menus, sf company settings and
 * company registration.
 *
 * The `/api/settings/company/:companyId` routes carry the company in the path,
 * so they run the company scope check inline.
 */
export function platformAccountRoutes(deps: PlatformDeps): Hono<AppEnv> {
  const scope = companyScope(deps)
  const uploadLimit = bodyLimit({
    maxSize: deps.maxUploadBytes,
    onError: (c) => c.json({ detail: 'The file is too large.', code: 'PAYLOAD_TOO_LARGE' }, 413),
  })
  const attachmentName = (value: string): AttachmentName => {
    if (!isAttachmentName(value)) throw invalidField('name', 'Unknown attachment name.')
    return value
  }

  return new Hono<AppEnv>({ strict: false })
    .post('/api/logout', (c) => {
      if (c.var.sessionId !== null) revokeSession(deps.db, c.var.sessionId, deps.clock.now())
      clearSessionCookies(c)
      return c.body(null, 204)
    })
    .get('/api/user/me', (c) => c.json(getMe(deps, c.var.user)))
    .post('/api/user/me/jwt', zValidator('json', jwtBody, validationHook), async (c) =>
      c.json({ token: await issueCompanyJwt(deps, c.var.user, c.req.valid('json').company_id) }),
    )
    .patch('/api/user/me/password-change', zValidator('json', passwordBody, validationHook), (c) => {
      const body = c.req.valid('json')
      changeOwnPassword(deps, c.var.user, body.password, body.confirm_password)
      clearSessionCookies(c)
      return c.body(null, 204)
    })
    .get('/api/user/me/term-agreements', zValidator('query', purposeQuery, validationHook), (c) => {
      const query = c.req.valid('query')
      return c.json(listTermAgreements(deps, { userId: c.var.user.id }, query.purpose ?? query.purpose_code ?? 'signup'))
    })
    .patch('/api/user/me/term-agreements', zValidator('query', purposeQuery, validationHook), zValidator('json', termAgreementsBody, validationHook), (c) => {
      const query = c.req.valid('query')
      const terms = recordAgreements(deps, { userId: c.var.user.id }, c.req.valid('json').agreements, clientOf(c), deps.taxTermsVersion)
      const purpose = query.purpose ?? query.purpose_code ?? terms[0]?.purpose_code ?? 'signup'
      return c.json(listTermAgreements(deps, { userId: c.var.user.id }, purpose))
    })
    .get('/api/member/profile', (c) => {
      const user = findUser(deps.db, c.var.user.id)
      if (user === undefined) throw notFound('User')
      return c.json(serializeProfile(user))
    })
    .get('/api/member/active_invitations', (c) => {
      const user = findUser(deps.db, c.var.user.id)
      if (user === undefined) throw notFound('User')
      const now = deps.clock.now()
      const results = listPendingInvitationsForEmail(deps.db, user.email)
        .filter((row) => effectiveStatus(row, now) === 'pending')
        .map((row) => ({ id: row.id, company_id: row.company_id, company_name: row.company_name, is_admin: row.is_admin === 1, expires_at: row.expires_at }))
      return c.json({ results })
    })
    .get('/api/member/chat-channel', zValidator('query', tokenQuery, validationHook), (c) => c.json(checkChatChannelToken(deps, c.req.valid('query').token)))
    .post('/api/member/chat-channel', zValidator('json', chatChannelBody, validationHook), (c) => {
      const body = c.req.valid('json')
      return c.json(connectChatChannel(deps, c.var.user, body.token, body.company_id), 201)
    })
    .get('/api/perm/menus', (c) => {
      const companyId = c.req.query('company_id')
      const company = companyId === undefined ? undefined : findCompany(deps.db, companyId)
      const context = company === undefined ? null : loadAccessContext(deps.db, c.var.user, company, deps.taxTermsVersion)
      return c.json(permissionCatalog(deps.db, context))
    })
    .get('/api/perm/roles', (c) => c.json(listTemplates(deps)))
    .post('/api/signup/company', zValidator('json', companyBody, validationHook), async (c) => {
      const company = await registerCompanyForUser(deps, c.var.user, c.req.valid('json'))
      return c.json(getCompanyDetail(deps, company.id), 201)
    })
    .post('/api/signup/company/:token', zValidator('json', invitationCompanyBody, validationHook), (c) => {
      const company = registerCompanyByInvitation(deps, c.req.param('token'), c.var.user, c.req.valid('json'))
      return c.json(getCompanyDetail(deps, company.id), 201)
    })
    .get('/api/settings/company/:companyId', scope, (c) => c.json(getCompanyDetail(deps, c.var.company.id)))
    .patch('/api/settings/company/:companyId', scope, requireMenu('company_management'), zValidator('json', companySettingsBody, validationHook), (c) =>
      c.json(updateCompanySettings(deps, c.var.company.id, c.req.valid('json'))),
    )
    .get('/api/settings/company/:companyId/attachments', scope, zValidator('query', attachmentQuery, validationHook), (c) =>
      c.json(getAttachment(deps, c.var.company.id, attachmentName(c.req.valid('query').name))),
    )
    .get('/api/settings/company/:companyId/attachments/download', scope, zValidator('query', attachmentQuery, validationHook), async (c) => {
      const { file, data } = await readAttachment(deps, c.var.company.id, attachmentName(c.req.valid('query').name))
      return fileResponse(c, file, data)
    })
    .put('/api/settings/company/:companyId/attachments', scope, requireMenu('company_management'), uploadLimit, async (c) => {
      const { upload, fields } = await readMultipartUpload(c)
      const name = attachmentName(fields['name'] ?? '')
      return c.json(await putAttachment(deps, c.var.company.id, c.var.user, name, upload))
    })
    .get('/api/settings/company/:companyId/attachments_form', scope, (c) => c.json(attachmentForms()))
    .get('/api/settings/company/:companyId/contract', scope, requireCompanyAdmin(), zValidator('query', attachmentQuery, validationHook), (c) =>
      c.json(getCompanyContract(deps, c.var.company.id, c.req.valid('query').name)),
    )
}
