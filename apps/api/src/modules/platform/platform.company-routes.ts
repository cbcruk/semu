import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import type { AppEnv } from '../../app.types'
import { parsePageRequest, toPage } from '../../lib/drf-pagination'
import { invalidField } from '../../lib/domain-error'
import { toPlainDate } from '../../lib/plain-date'
import { requireMenu } from '../../middleware/access'
import { validationHook } from '../../middleware/validation'
import { isFreeCompany } from '../companies/companies.utils'
import { buildMenuTree, loadMenuTree } from '../menu-tree/menu-tree.service'
import { deleteConversation, getConversation, listConversations, recommendGrants, sendAssistantMessage } from './assistant/assistant.service'
import { findMandate, listPayments, listSubscriptions } from './billing/billing.repository'
import { changeSubscription, retryPayment } from './billing/billing.service'
import type { SubscriptionCode } from './billing/billing.types'
import { serializePayment, serializeSubscriptions } from './billing/billing.utils'
import { getCompanyDetail, updateCompanySettings } from './company-profile/company-profile.service'
import { listFavorites, listRoles } from './company-users/company-users.repository'
import {
  accessibleMenus,
  addFavorite,
  checkPermission,
  companyMenus,
  createRole,
  getCompanyUser,
  inviteCondition,
  listCompanyRoles,
  listCompanyUsers,
  patchRole,
  removeCompanyUser,
  removeFavorite,
  removeRole,
  roleMembers,
  setPermissions,
} from './company-users/company-users.service'
import { annotateFavorites } from './company-users/menu-catalog'
import { integrationRoutes } from './integrations/integrations.routes'
import { cancelInvitation, createInvitation, listCompanyInvitations, serializeInvitation } from './invitations/invitations.service'
import { submitConsult } from './leads/leads.service'
import { requireAgencyActor, requireCompanyAdmin } from './platform.middleware'
import {
  assistantMessageBody,
  companySettingsBody,
  companyUsersQuery,
  consultBody,
  emailQuery,
  favoriteBody,
  invitationBody,
  pageQuery,
  permissionCheckQuery,
  permissionsBody,
  retryBody,
  roleBody,
  subscriptionBody,
} from './platform.schema'
import type { PlatformDeps } from './platform.types'

/**
 * Platform routes mounted under `/api/company/:companyId`: company detail,
 * users and permissions, invitations, roles, subscriptions, payments,
 * consultations, the AI assistant, grants and institution links.
 *
 * User, invitation and role management need the `user_management` menu and the
 * company admin role; subscription changes and payment retries are agency
 * desk actions.
 */
export function platformCompanyRoutes(deps: PlatformDeps): Hono<AppEnv> {
  const manageUsers = [requireMenu('user_management'), requireCompanyAdmin()] as const
  const subscriptionCode = (value: string): SubscriptionCode => {
    if (value !== 'tax' && value !== 'payroll') throw invalidField('code', 'Unknown subscription code.')
    return value
  }
  const roleNames = (companyId: string): Map<string, string> => new Map(listRoles(deps.db, companyId).map((role) => [role.id, role.name]))

  return new Hono<AppEnv>({ strict: false })
    .get('/', (c) => c.json(getCompanyDetail(deps, c.var.company.id)))
    .patch('/', requireMenu('company_management'), requireCompanyAdmin(), zValidator('json', companySettingsBody, validationHook), (c) =>
      c.json(updateCompanySettings(deps, c.var.company.id, c.req.valid('json'))),
    )
    .get('/user', ...manageUsers, zValidator('query', companyUsersQuery, validationHook), (c) =>
      c.json(listCompanyUsers(deps, c.var.company.id, c.var.user, c.req.valid('query').status)),
    )
    .get('/user/invitation', ...manageUsers, zValidator('query', emailQuery, validationHook), (c) =>
      c.json(inviteCondition(deps, c.var.company.id, c.req.valid('query').email)),
    )
    .get('/user/me/menus', (c) => c.json(accessibleMenus(deps, c.var.access)))
    .post('/user/me/menus/favorites', zValidator('json', favoriteBody, validationHook), (c) => {
      addFavorite(deps, c.var.access, c.var.company.id, c.req.valid('json').menu_id)
      return c.json({ menu_id: c.req.valid('json').menu_id }, 201)
    })
    .delete('/user/me/menus/favorites/:menuId', (c) => {
      removeFavorite(deps, c.var.company.id, c.var.user.id, Number.parseInt(c.req.param('menuId'), 10))
      return c.body(null, 204)
    })
    .get('/user/me/menu-tree/:version', (c) => {
      const nodes = buildMenuTree(loadMenuTree(deps.db, c.req.param('version')), c.var.access, isFreeCompany(c.var.company))
      return c.json(annotateFavorites(nodes, c.var.access, listFavorites(deps.db, c.var.company.id, c.var.user.id)))
    })
    .get('/user/:userId', ...manageUsers, (c) => c.json(getCompanyUser(deps, c.var.company.id, c.req.param('userId'))))
    .put('/user/:userId/permissions', ...manageUsers, zValidator('json', permissionsBody, validationHook), (c) => {
      const body = c.req.valid('json')
      return c.json(setPermissions(deps, c.var.company.id, c.req.param('userId'), body.is_admin, body.role_ids))
    })
    .delete('/user/:userId', ...manageUsers, (c) => {
      removeCompanyUser(deps, c.var.company.id, c.req.param('userId'))
      return c.body(null, 204)
    })
    .get('/user/:userId/permission-check', zValidator('query', permissionCheckQuery, validationHook), (c) => {
      const query = c.req.valid('query')
      return c.json(checkPermission(c.var.access, c.var.user, query.function, query.action))
    })
    .get('/menus', (c) => c.json(companyMenus(deps, c.var.access)))
    .get('/internal-invitation', ...manageUsers, (c) => {
      const names = roleNames(c.var.company.id)
      return c.json(listCompanyInvitations(deps, c.var.company.id).map((row) => serializeInvitation(row, deps.clock.now(), names)))
    })
    .post('/internal-invitation', ...manageUsers, zValidator('json', invitationBody, validationHook), async (c) => {
      const invitation = await createInvitation(deps, c.var.company.id, c.var.user, c.req.valid('json'))
      return c.json(serializeInvitation(invitation, deps.clock.now(), roleNames(c.var.company.id)), 201)
    })
    .delete('/internal-invitation/:invitationId', ...manageUsers, (c) => {
      cancelInvitation(deps, c.var.company.id, c.req.param('invitationId'))
      return c.body(null, 204)
    })
    .get('/perm/role', ...manageUsers, (c) => c.json(listCompanyRoles(deps, c.var.company.id)))
    .post('/perm/role', ...manageUsers, zValidator('json', roleBody, validationHook), (c) => c.json(createRole(deps, c.var.company.id, c.req.valid('json')), 201))
    .patch('/perm/role/:roleId', ...manageUsers, zValidator('json', roleBody.partial(), validationHook), (c) =>
      c.json(patchRole(deps, c.var.company.id, c.req.param('roleId'), c.req.valid('json'))),
    )
    .delete('/perm/role/:roleId', ...manageUsers, (c) => {
      removeRole(deps, c.var.company.id, c.req.param('roleId'))
      return c.body(null, 204)
    })
    .get('/perm/role/:roleId/company-users', ...manageUsers, (c) => c.json(roleMembers(deps, c.var.company.id, c.req.param('roleId'))))
    .get('/perm/subscription', (c) => c.json(serializeSubscriptions(listSubscriptions(deps.db, c.var.company.id), deps.clock.today())))
    .put('/perm/subscription/:code', requireAgencyActor(), zValidator('json', subscriptionBody, validationHook), (c) => {
      const body = c.req.valid('json')
      changeSubscription(deps, c.var.company.id, subscriptionCode(c.req.param('code')), {
        status: body.status,
        startedOn: body.started_on,
        endedOn: body.ended_on,
        monthlyFee: body.monthly_fee,
      })
      return c.json(serializeSubscriptions(listSubscriptions(deps.db, c.var.company.id), deps.clock.today()))
    })
    .post('/consult', zValidator('json', consultBody, validationHook), async (c) =>
      c.json(await submitConsult(deps, c.req.valid('json'), { companyId: c.var.company.id, userId: c.var.user.id }), 201),
    )
    .get('/payment', requireMenu('service_payment'), zValidator('query', pageQuery, validationHook), (c) => {
      const query = c.req.valid('query')
      const request = parsePageRequest(query.limit, query.offset)
      const { rows, count } = listPayments(deps.db, c.var.company.id, request.limit, request.offset)
      const results = rows.map((row) => serializePayment(row, row.mandate_id === null ? undefined : findMandate(deps.db, row.mandate_id)))
      return c.json(toPage(results, count, request, c.req.url))
    })
    .post('/payment/:paymentId/retry', requireAgencyActor(), zValidator('json', retryBody, validationHook), (c) => {
      const payment = retryPayment(deps, c.var.company.id, Number.parseInt(c.req.param('paymentId'), 10), toPlainDate(c.req.valid('json').retry_on), c.var.user.id)
      return c.json(serializePayment(payment, payment.mandate_id === null ? undefined : findMandate(deps.db, payment.mandate_id)))
    })
    .get('/ai-agent/conversations', requireMenu('ai_agent'), (c) => c.json(listConversations(deps, c.var.company.id, c.var.user.id)))
    .get('/ai-agent/conversations/:conversationId', requireMenu('ai_agent'), (c) =>
      c.json(getConversation(deps, c.var.company.id, c.var.user.id, c.req.param('conversationId'))),
    )
    .delete('/ai-agent/conversations/:conversationId', requireMenu('ai_agent'), (c) => {
      deleteConversation(deps, c.var.company.id, c.var.user.id, c.req.param('conversationId'))
      return c.body(null, 204)
    })
    .post('/ai-agent/messages', requireMenu('ai_agent'), zValidator('json', assistantMessageBody, validationHook), async (c) => {
      const body = c.req.valid('json')
      return c.json(await sendAssistantMessage(deps, c.var.access, c.var.company.id, body.conversation_id, body.message), 201)
    })
    .get('/grants/recommendations', requireMenu('grant_recommendation'), (c) => c.json({ results: recommendGrants(deps, c.var.company.id) }))
    .route('/', integrationRoutes(deps))
}
