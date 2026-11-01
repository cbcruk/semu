import { z } from 'zod'

const email = z.email().max(254)
const password = z.string().min(1).max(100)
const businessType = z.enum(['corporate', 'individual'])
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/** One answer to a term, identified by `term_id` or `code`. */
export const agreementItem = z
  .object({ term_id: z.number().int().positive().optional(), code: z.string().min(1).optional(), is_agreed: z.boolean() })
  .refine((value) => value.term_id !== undefined || value.code !== undefined, { message: 'Send term_id or code.' })

const agreements = z.array(agreementItem).max(50)

/** Body of `POST /api/login/`. */
export const loginBody = z.object({ email, password, stay_signed_in: z.boolean().default(false) })

/** Body of `POST /api/login/social/`. */
export const socialLoginBody = z.object({ provider: z.literal('kakao'), code: z.string().min(1).max(500) })

/** Query of `GET /api/login/overtax/`. */
export const tokenQuery = z.object({ token: z.string().min(1) })

/** Body of `POST /api/user/me/jwt/`. */
export const jwtBody = z.object({ company_id: z.string().min(1) })

/** Body of password changes and resets. */
export const passwordBody = z.object({ password, confirm_password: password })

/** Query naming a terms purpose; the legacy screens send `purpose` or `purpose_code`. */
export const purposeQuery = z.object({ purpose: z.string().min(1).optional(), purpose_code: z.string().min(1).optional() })

/** Body of `PATCH /api/user/me/term-agreements/`. */
export const termAgreementsBody = z.object({ agreements })

/** Query of the guest agreement lookup. */
export const guestAgreementsQuery = z.object({ email, purpose_code: z.string().min(1) })

/** Body of the guest agreement submission. */
export const guestAgreementsBody = z.object({ email, purpose_code: z.string().min(1), agreements })

/** Query of `GET /api/pre-signup/check/business_number/`. */
export const businessNumberQuery = z.object({ business_number: z.string().min(1) })

/** Query of `GET /api/pre-signup/check-email-duplicate/`. */
export const emailQuery = z.object({ email })

/** Body of `POST /api/pre-signup/send-verification-email/`. */
export const emailBody = z.object({ email })

/** Body of `POST /api/signup/user/email/:token/`. */
export const signupBody = z.object({
  email: email.optional(),
  password,
  confirm_password: password,
  name: z.string().min(1).max(50).optional(),
  phone: z.string().min(9).max(20).optional(),
  agreements,
})

/** Body of `POST /api/signup/user/invitation/:token/`. */
export const invitationSignupBody = z.object({
  password: password.optional(),
  confirm_password: password.optional(),
  name: z.string().min(1).max(50).optional(),
  phone: z.string().min(9).max(20).optional(),
  agreements: agreements.optional(),
})

/** Body of company registration. */
export const companyBody = z.object({
  name: z.string().min(1).max(100),
  business_number: z.string().min(10).max(12),
  business_type: businessType,
  phone: z.string().min(9).max(20).optional(),
  representative_name: z.string().min(1).max(50).optional(),
})

/** Body of company registration by signup invitation; the invitation fills missing fields. */
export const invitationCompanyBody = companyBody.partial()

/** Body of `PATCH /api/company/:id/` and `PATCH /api/settings/company/:id/`. */
export const companySettingsBody = z.object({
  phone: z.string().min(9).max(20).optional(),
  business_category: z.string().min(1).max(100).optional(),
  zip_code: z.string().regex(/^\d{5}$/).optional(),
  address: z.string().min(1).max(200).optional(),
  address_detail: z.string().max(200).nullable().optional(),
  payday_month: z.enum(['current', 'next']).optional(),
  payday_day: z.string().regex(/^(?:[1-9]|[12]\d|3[01]|last)$/).optional(),
  corporate_number: z.string().max(14).nullable().optional(),
  corp_investment_type: z.number().int().nullable().optional(),
  corp_type: z.number().int().nullable().optional(),
  established_on: isoDate.nullable().optional(),
  representatives: z
    .array(z.object({ role: z.enum(['boss', 'co_boss']), name: z.string().min(1).max(50), phone: z.string().max(20).nullable().optional() }))
    .min(1)
    .max(5)
    .optional(),
})

/** Query of the attachment endpoints. */
export const attachmentQuery = z.object({ name: z.string().min(1) })

/** Body of `POST /api/company/hometax/`. */
export const hometaxAgreeBody = z.object({ company_id: z.string().min(1).optional(), agreement_id: z.string().min(1) })

/** Query of `GET /api/company/hometax/`. */
export const hometaxQuery = z.object({ company_id: z.string().min(1).optional(), agreement_id: z.string().min(1).optional() })

/** Body of the external partner attach call. */
export const partnerAttachBody = z.object({ email, password, business_number: z.string().min(10).max(12) })

/** Body of the external partner join call. */
export const partnerJoinBody = z.object({
  email,
  password,
  name: z.string().min(1).max(50).optional(),
  company_name: z.string().min(1).max(100),
  business_number: z.string().min(10).max(12),
  business_type: businessType,
})

/** Body of both consultation forms. */
export const consultBody = z.object({
  name: z.string().min(1).max(50),
  phone: z.string().min(9).max(20),
  email,
  company_name: z.string().max(100).optional(),
  business_number: z.string().max(12).optional(),
  legal_form: z.number().int().optional(),
  label_ids: z.array(z.number().int()).max(20).default([]),
  consulting_privacy_date: z.string().min(1),
  consulting_third_party_date: z.string().min(1),
  utm_source: z.string().max(100).optional(),
  utm_medium: z.string().max(100).optional(),
  utm_campaign: z.string().max(100).optional(),
  utm_content: z.string().max(100).optional(),
  memo: z.string().max(2000).optional(),
})

/** Body of `POST /public/api/alfred/withdrawal-consent`. */
export const withdrawalConsentBody = z.object({
  business_number: z.string().min(10).max(12),
  bank_code: z.string().regex(/^\d{3}$/),
  account_number: z.string().regex(/^[\d-]{6,20}$/),
  account_holder: z.string().min(1).max(50),
  payer_id: z.string().regex(/^\d{6}$|^\d{10}$/),
  agreed: z.literal(true),
})

/** Query of the online lead endpoints. */
export const leadQuery = z.object({ timestamp: z.string().min(1).max(40) })

/** Body of the online lead endpoints; unknown fields are kept as lead data. */
export const leadBody = z.record(z.string(), z.unknown())

/** Body of `POST /api/member/chat-channel/`. */
export const chatChannelBody = z.object({ token: z.string().min(1), company_id: z.string().min(1) })

/** Body of `POST /api/join/signup-invitations/`. */
export const signupInvitationBody = z.object({ token: z.string().min(1), email })

/** Body of `POST /api/join/contracts/:signupSession/`. */
export const signupContractBody = z.object({ agreements })

/** Body of `POST /api/join/direct-contract/calculate-fee/`. */
export const feeBody = z.object({
  contract_id: z.string().min(1).optional(),
  revenue: z.string().min(1),
  employee_number: z.enum(['under_10', 'from_10_to_20', 'from_21_to_30', 'from_31_to_50', 'above_50']),
  business_type: z.enum(['etc', 'construction', 'manufacturing', 'trade', 'lending', 'other_professional_service']),
  accounting_period: z.enum(['annual', 'semi_annual', 'quarterly', 'monthly']),
  diligent_business: z.enum(['no', 'yes']),
})

/** Body of `POST /api/join/direct-contract/send-sms/:contractId/`. */
export const phoneBody = z.object({ phone_number: z.string().min(9).max(20) })

/** Body of `POST /api/join/direct-contract/verify-sms/:contractId/`. */
export const smsVerifyBody = z.object({ phone_number: z.string().min(9).max(20), code: z.string().regex(/^\d{6}$/) })

/** Body of `POST /api/join/direct-contract/request-contract-form/:contractId/`. */
export const contractFormBody = z.object({
  company_name: z.string().min(1).max(100),
  representative_name: z.string().min(1).max(50),
  email,
  address: z.string().max(200).optional(),
})

/** Body of `POST /api/join/direct-contract/sign-contract/:contractId/`. */
export const signContractBody = z.object({ signature: z.string().min(1).max(500_000), agreements, email: email.optional() })

/** Query of `GET /api/company/:id/user/`. */
export const companyUsersQuery = z.object({ status: z.enum(['joined', 'invited', 'expired']).optional() })

/** Body of `PUT /api/company/:id/user/:uid/permissions/`. */
export const permissionsBody = z.object({ is_admin: z.boolean(), role_ids: z.array(z.string().min(1)).max(50).default([]) })

/** Query of `GET /api/company/:id/user/:uid/permission-check/`. */
export const permissionCheckQuery = z.object({ function: z.string().min(1), action: z.string().min(1).default('read') })

/** Body of `POST /api/company/:id/user/me/menus/favorites/`. */
export const favoriteBody = z.object({ menu_id: z.number().int().positive() })

/** Body of `POST /api/company/:id/internal-invitation/`. */
export const invitationBody = z.object({ email, is_admin: z.boolean().default(false), role_ids: z.array(z.string().min(1)).max(50).default([]) })

/** Body of `POST /api/internal-invitation/:token/accept/`. */
export const acceptInvitationBody = z
  .object({
    password: password.optional(),
    confirm_password: password.optional(),
    name: z.string().min(1).max(50).optional(),
    agreements: agreements.optional(),
  })
  .default({})

/** Body of role creation. */
export const roleBody = z.object({
  name: z.string().min(1).max(50),
  menu_ids: z.array(z.number().int().positive()).max(200).optional(),
  menu_codes: z.array(z.string().min(1)).max(200).optional(),
})

/** Body of `PUT /api/company/:id/perm/subscription/:code`. */
export const subscriptionBody = z.object({
  status: z.enum(['pending', 'active', 'cancelled', 'ended']),
  started_on: isoDate,
  ended_on: isoDate.nullable().default(null),
  monthly_fee: z.number().int().min(0).default(0),
})

/** Body of `POST /api/company/:id/payment/:paymentId/retry`. */
export const retryBody = z.object({ retry_on: isoDate })

/** Query of the payment list. */
export const pageQuery = z.object({ limit: z.string().optional(), offset: z.string().optional() })

/** Body of `POST /api/company/:id/ai-agent/messages`. */
export const assistantMessageBody = z.object({ conversation_id: z.string().min(1).nullable().default(null), message: z.string().min(1).max(4000) })
