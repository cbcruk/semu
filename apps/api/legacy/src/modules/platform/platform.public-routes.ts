import { zValidator } from '@hono/zod-validator'
import { Hono, type Context } from 'hono'
import type { AppEnv, AuthUser } from '../../app.types'
import { DomainError, invalidField, notFound } from '../../lib/domain-error'
import { authenticate, resolveCredentials } from '../../middleware/auth'
import { companyScope } from '../../middleware/company-scope'
import { validationHook } from '../../middleware/validation'
import { DEMO_ACCOUNT } from './accounts/demo-account'
import { checkBusinessNumber, isEmailTaken, sendSignupVerification, serializeProfile, signupWithToken } from './accounts/accounts.service'
import { findUser, findUserByEmail } from './accounts/users.repository'
import { login, requestPasswordReset, requireResetToken, resetPassword, socialLogin } from './auth/auth.service'
import type { IssuedSession, UserRow } from './auth/auth.types'
import { writeSessionCookies } from './auth/session-cookies'
import { listSubscriptions } from './billing/billing.repository'
import { registerWithdrawalConsent } from './billing/billing.service'
import { serializeSubscriptions } from './billing/billing.utils'
import { isMember } from './company-profile/company-profile.repository'
import { agreeHometaxDelegation, getHometaxDelegation } from './company-profile/company-documents.service'
import {
  agreeSignupContract,
  calculateFee,
  checkSignupInvitation,
  requestContractForm,
  sendContractSms,
  signContract,
  signupByInvitation,
  verifyContractBusiness,
  verifyContractSms,
  verifySignupEmail,
} from './contracts/contracts.service'
import {
  assertPartnerJoinInput,
  attachCompany,
  joinCompany,
  overtaxLogin,
  partnerFromApiKey,
  payloadState,
  systemAdminEmails,
  verifyPartnerPayload,
} from './external/external.service'
import { acceptInvitation, describeInvitation } from './invitations/invitations.service'
import { createOnlineLead, patchOnlineLead, submitConsult } from './leads/leads.service'
import { clientOf } from './platform.middleware'
import {
  acceptInvitationBody,
  businessNumberQuery,
  consultBody,
  contractFormBody,
  emailBody,
  emailQuery,
  feeBody,
  guestAgreementsBody,
  guestAgreementsQuery,
  hometaxAgreeBody,
  hometaxQuery,
  invitationSignupBody,
  leadBody,
  leadQuery,
  loginBody,
  partnerAttachBody,
  partnerJoinBody,
  passwordBody,
  phoneBody,
  purposeQuery,
  signContractBody,
  signupBody,
  signupContractBody,
  signupInvitationBody,
  smsVerifyBody,
  socialLoginBody,
  tokenQuery,
  withdrawalConsentBody,
} from './platform.schema'
import type { PlatformDeps } from './platform.types'
import { requireBusinessNumber } from './platform.utils'
import { listCurrentTerms } from './terms/terms.repository'
import { assertRequiredTermsAnswered, listTermAgreements, recordAgreements } from './terms/terms.service'
import { toTermSummary } from './terms/terms.utils'

/**
 * Platform routes mounted before authentication: sign-in, signup, invitations,
 * contracts, partner calls and the public lead forms.
 *
 * Routes that accept an optional signed-in user resolve the credentials
 * themselves; `/api/company/hometax` and `/nexus-api/company/:companyId/subscriptions`
 * authenticate inline because they sit outside the authenticated mounts.
 */
export function platformPublicRoutes(deps: PlatformDeps): Hono<AppEnv> {
  const signedIn = async (c: Context<AppEnv>): Promise<AuthUser | null> => (await resolveCredentials(deps, c))?.user ?? null
  const respondSession = (c: Context<AppEnv>, user: UserRow, session: IssuedSession, status: 200 | 201 = 200): Response => {
    writeSessionCookies(c, session)
    return c.json({ user: serializeProfile(user), csrf_token: session.csrfToken, expires_at: session.expiresAt }, status)
  }

  return new Hono<AppEnv>({ strict: false })
    .post('/api/login', zValidator('json', loginBody, validationHook), (c) => {
      const body = c.req.valid('json')
      const { user, session } = login(deps, { email: body.email, password: body.password, staySignedIn: body.stay_signed_in }, clientOf(c))
      return respondSession(c, user, session)
    })
    .post('/api/login/social', zValidator('json', socialLoginBody, validationHook), async (c) => {
      const body = c.req.valid('json')
      const result = await socialLogin(deps, body.provider, body.code, clientOf(c))
      if ('session' in result) {
        writeSessionCookies(c, result.session)
        return c.json({ status: result.status, user: serializeProfile(result.user), csrf_token: result.session.csrfToken })
      }
      if (result.status === 'need_to_registration') return c.json({ status: result.status, email: result.email, signup_token: result.signupToken })
      return c.json({ status: result.status, email: result.email })
    })
    .get('/api/login/overtax', zValidator('query', tokenQuery, validationHook), async (c) => {
      const { user, session } = await overtaxLogin(deps, c.req.valid('query').token, clientOf(c))
      return respondSession(c, user, session)
    })
    .get('/api/member/demo', (c) => {
      if (findUserByEmail(deps.db, DEMO_ACCOUNT.email) === undefined) throw notFound('Demo account')
      return c.json(DEMO_ACCOUNT)
    })
    .get('/api/terms', zValidator('query', purposeQuery, validationHook), (c) => {
      const query = c.req.valid('query')
      const purpose = query.purpose_code ?? query.purpose
      if (purpose === undefined) throw invalidField('purpose_code', 'Send purpose_code.')
      return c.json(listCurrentTerms(deps.db, purpose, deps.clock.today()).map(toTermSummary))
    })
    .get('/api/password-change/:token', (c) => {
      requireResetToken(deps, c.req.param('token'))
      return c.json({ valid: true })
    })
    .post('/api/password-change/:token', zValidator('json', passwordBody, validationHook), (c) => {
      const body = c.req.valid('json')
      resetPassword(deps, c.req.param('token'), body.password, body.confirm_password)
      return c.body(null, 204)
    })
    .post('/api/request-password-change-email/:email', async (c) => {
      await requestPasswordReset(deps, decodeURIComponent(c.req.param('email')))
      return c.body(null, 202)
    })
    .get('/api/pre-signup/check/business_number', zValidator('query', businessNumberQuery, validationHook), async (c) =>
      c.json(await checkBusinessNumber(deps, c.req.valid('query').business_number)),
    )
    .get('/api/pre-signup/check-email-duplicate', zValidator('query', emailQuery, validationHook), (c) =>
      c.json({ is_duplicated: isEmailTaken(deps, c.req.valid('query').email) }),
    )
    .post('/api/pre-signup/send-verification-email', zValidator('json', emailBody, validationHook), async (c) => {
      await sendSignupVerification(deps, c.req.valid('json').email)
      return c.body(null, 202)
    })
    .post('/api/signup/user/email/:token', zValidator('json', signupBody, validationHook), (c) => {
      const { user, session } = signupWithToken(deps, c.req.param('token'), c.req.valid('json'), clientOf(c))
      return respondSession(c, user, session, 201)
    })
    .post('/api/signup/user/invitation/:token', zValidator('json', invitationSignupBody, validationHook), async (c) => {
      const result = signupByInvitation(deps, c.req.param('token'), c.req.valid('json'), await signedIn(c), clientOf(c))
      if (result.session !== null) writeSessionCookies(c, result.session)
      return c.json({ user: serializeProfile(result.user), created: result.created }, result.created ? 201 : 200)
    })
    .get('/api/internal-invitation/:token', (c) => c.json(describeInvitation(deps, c.req.param('token'))))
    .post('/api/internal-invitation/:token/accept', zValidator('json', acceptInvitationBody, validationHook), async (c) => {
      const result = acceptInvitation(deps, c.req.param('token'), c.req.valid('json'), await signedIn(c), clientOf(c))
      if (result.session !== null) writeSessionCookies(c, result.session)
      const user = findUser(deps.db, result.userId)
      return c.json({ user: user === undefined ? null : serializeProfile(user), company_id: result.companyId }, 201)
    })
    .get('/api/join/signup-invitations/:token/existence', (c) => c.json(checkSignupInvitation(deps, c.req.param('token'))))
    .post('/api/join/signup-invitations', zValidator('json', signupInvitationBody, validationHook), (c) => {
      const body = c.req.valid('json')
      return c.json(verifySignupEmail(deps, body.token, body.email))
    })
    .post('/api/join/contracts/:signupSession', zValidator('json', signupContractBody, validationHook), (c) =>
      c.json(agreeSignupContract(deps, c.req.param('signupSession'), c.req.valid('json').agreements, clientOf(c))),
    )
    .post('/api/join/direct-contract/calculate-fee', zValidator('json', feeBody, validationHook), (c) => {
      const { contract_id: contractId, ...inputs } = c.req.valid('json')
      return c.json(calculateFee(deps, inputs, contractId))
    })
    .post('/api/join/direct-contract/send-sms/:contractId', zValidator('json', phoneBody, validationHook), async (c) => {
      await sendContractSms(deps, c.req.param('contractId'), c.req.valid('json').phone_number)
      return c.body(null, 202)
    })
    .post('/api/join/direct-contract/verify-sms/:contractId', zValidator('json', smsVerifyBody, validationHook), (c) => {
      const body = c.req.valid('json')
      return c.json(verifyContractSms(deps, c.req.param('contractId'), body.phone_number, body.code))
    })
    .post('/api/join/direct-contract/request-contract-form/:contractId', zValidator('json', contractFormBody, validationHook), (c) =>
      c.json(requestContractForm(deps, c.req.param('contractId'), c.req.valid('json'))),
    )
    .post('/api/join/direct-contract/sign-contract/:contractId', zValidator('json', signContractBody, validationHook), (c) =>
      c.json(signContract(deps, c.req.param('contractId'), c.req.valid('json'), clientOf(c)), 201),
    )
    .get('/api/join/direct-contract/:contractId/:businessNumber', (c) =>
      c.json(verifyContractBusiness(deps, c.req.param('contractId'), c.req.param('businessNumber'))),
    )
    .post('/api/lead/online', zValidator('query', leadQuery, validationHook), zValidator('json', leadBody, validationHook), (c) =>
      c.json(createOnlineLead(deps, c.req.valid('query').timestamp, c.req.valid('json')), 201),
    )
    .patch('/api/lead/online', zValidator('query', leadQuery, validationHook), zValidator('json', leadBody, validationHook), (c) =>
      c.json(patchOnlineLead(deps, c.req.valid('query').timestamp, c.req.valid('json'))),
    )
    .get('/api/external/validate_payload', async (c) => {
      const { partnerId, claims } = await verifyPartnerPayload(deps, bearerOf(c))
      return c.json(payloadState(deps, partnerId, claims))
    })
    .get('/api/external/company_system_admin_list', async (c) => {
      const { claims } = await verifyPartnerPayload(deps, bearerOf(c))
      return c.json(systemAdminEmails(deps, claims))
    })
    .post('/api/external/attach', zValidator('json', partnerAttachBody, validationHook), (c) => {
      const partnerId = partnerFromApiKey(deps, c.req.header('X-API-KEY'))
      return c.json(attachCompany(deps, partnerId, c.req.valid('json')))
    })
    .post('/api/external/join-company', zValidator('json', partnerJoinBody, validationHook), (c) => {
      const partnerId = partnerFromApiKey(deps, c.req.header('X-API-KEY'))
      const body = c.req.valid('json')
      assertPartnerJoinInput(body)
      return c.json(joinCompany(deps, partnerId, body), 201)
    })
    .post('/public/api/consult', zValidator('json', consultBody, validationHook), async (c) => c.json(await submitConsult(deps, c.req.valid('json'), null), 201))
    .post('/public/api/alfred/withdrawal-consent', zValidator('json', withdrawalConsentBody, validationHook), async (c) => {
      const body = c.req.valid('json')
      const mandate = await registerWithdrawalConsent(deps, {
        businessNumber: requireBusinessNumber(body.business_number),
        bankCode: body.bank_code,
        accountNumber: body.account_number.replace(/-/g, ''),
        accountHolder: body.account_holder,
        payerId: body.payer_id,
      })
      if (mandate.status === 'rejected') throw new DomainError('VALIDATION_FAILED', 'The bank rejected the withdrawal account.', { fail_reason: 'account_rejected' })
      return c.json({ id: mandate.id, status: mandate.status, account_number: mandate.account_masked, bank_code: mandate.bank_code }, 201)
    })
    .get('/public/api/terms/agreements', zValidator('query', guestAgreementsQuery, validationHook), (c) => {
      const query = c.req.valid('query')
      return c.json(listTermAgreements(deps, { email: query.email }, query.purpose_code))
    })
    .post('/public/api/terms/agreements', zValidator('json', guestAgreementsBody, validationHook), (c) => {
      const body = c.req.valid('json')
      assertRequiredTermsAnswered(deps, body.purpose_code, body.agreements)
      recordAgreements(deps, { email: body.email }, body.agreements, clientOf(c), deps.taxTermsVersion)
      return c.json(listTermAgreements(deps, { email: body.email }, body.purpose_code), 201)
    })
    .get('/api/company/hometax', authenticate(deps), zValidator('query', hometaxQuery, validationHook), (c) => {
      const query = c.req.valid('query')
      const companyId = hometaxCompany(deps, c, query.company_id)
      return c.json(getHometaxDelegation(deps, companyId, query.agreement_id))
    })
    .post('/api/company/hometax', authenticate(deps), zValidator('json', hometaxAgreeBody, validationHook), (c) => {
      const body = c.req.valid('json')
      const companyId = hometaxCompany(deps, c, body.company_id)
      return c.json(agreeHometaxDelegation(deps, companyId, body.agreement_id, c.var.user.id))
    })
    .get('/nexus-api/company/:companyId/subscriptions', authenticate(deps), companyScope(deps), (c) =>
      c.json(serializeSubscriptions(listSubscriptions(deps.db, c.var.company.id), deps.clock.today())),
    )
}

function bearerOf(c: Context): string | undefined {
  const header = c.req.header('Authorization')
  return header?.startsWith('Bearer ') === true ? header.slice('Bearer '.length) : undefined
}

function hometaxCompany(deps: PlatformDeps, c: Context<AppEnv>, explicit: string | undefined): string {
  const tokenCompany = c.var.sessionId === null ? c.var.tokenCompanyId : null
  const companyId = explicit ?? tokenCompany
  if (companyId === null) throw invalidField('company_id', 'Send company_id.')
  if (!isMember(deps.db, companyId, c.var.user.id)) throw new DomainError('PERMISSION_DENIED', 'You are not a member of this company.')
  return companyId
}
