import { randomInt } from 'node:crypto'
import type { AuthUser, ServiceDeps } from '../../../app.types'
import { transaction } from '../../../db/query'
import { DomainError, invalidField, notFound } from '../../../lib/domain-error'
import { USER_TYPE } from '../../access/user-type'
import { findUser, findUserByEmail, insertUser } from '../accounts/users.repository'
import { createSession, type SessionClient } from '../auth/auth.service'
import type { IssuedSession, UserRow } from '../auth/auth.types'
import { assertNewPassword, hashPassword } from '../auth/password.utils'
import { applySubscriptionChange } from '../billing/billing.service'
import { findCompanyByBusinessNumber } from '../company-profile/company-profile.repository'
import { registerCompany } from '../company-profile/company-profile.service'
import type { CompanyProfileRow } from '../company-profile/company-profile.types'
import type { PlatformDeps } from '../platform.types'
import { addSeconds, isBefore, maskEmail, newId, normalizeEmail, requireBusinessNumber, sha256Hex } from '../platform.utils'
import { assertRequiredTermsAnswered, recordAgreements } from '../terms/terms.service'
import type { AgreementInput } from '../terms/terms.types'
import {
  findContract,
  findLatestSmsVerification,
  findSignedContractForBusiness,
  findSignupInvitation,
  findSignupInvitationByHash,
  findSignupSession,
  insertContract,
  insertSignupSession,
  insertSmsVerification,
  recordSignupAgreements,
  recordSmsAttempt,
  updateContract,
  updateSignupInvitation,
} from './contracts.repository'
import type { ContractForm, ContractRow, ContractStatus, FeeInputs, SignupInvitationRow } from './contracts.types'
import { isContractExpired, quoteFee, renderContract } from './contracts.utils'

const CONTRACT_TTL_SECONDS = 14 * 86_400
const SMS_TTL_SECONDS = 180
const SMS_MAX_ATTEMPTS = 5
const SMS_PURPOSE = 'direct_contract'
const CONTRACT_PURPOSE = 'contract'

/**
 * Quotes the bookkeeping fee and keeps it on a draft contract.
 *
 * Passing the `contract_id` of a draft re-quotes it instead of opening a new one.
 *
 * @throws {DomainError} `VALIDATION_FAILED` for unknown revenue bands, or `INVALID_TRANSITION` for contracts past the draft step.
 */
export function calculateFee(deps: ServiceDeps, inputs: FeeInputs, contractId: string | undefined): Record<string, unknown> {
  const quote = quoteFee(inputs)
  if (quote === null) throw invalidField('revenue', 'Unknown revenue band.')
  const now = deps.clock.now()
  let id = contractId
  if (id !== undefined) {
    const existing = requireOpenContract(deps, id)
    if (existing.status !== 'draft') throw new DomainError('INVALID_TRANSITION', 'The fee is fixed once the business number is confirmed.')
    updateContract(deps.db, id, { fee_inputs: JSON.stringify(inputs), monthly_fee: quote.monthlyFee, adjustment_fee: quote.adjustmentFee })
  } else {
    id = newId('ct')
    insertContract(deps.db, {
      id,
      company_id: null,
      business_number: null,
      representative_phone: null,
      fee_inputs: JSON.stringify(inputs),
      monthly_fee: quote.monthlyFee,
      adjustment_fee: quote.adjustmentFee,
      status: 'draft',
      form: null,
      signature: null,
      kind: 'online',
      auto_renew: 1,
      effective_on: null,
      identity_verified_at: null,
      sms_verified_at: null,
      form_requested_at: null,
      signed_at: null,
      created_at: now,
      expires_at: addSeconds(now, CONTRACT_TTL_SECONDS),
    })
  }
  return { contract_id: id, monthly_fee: quote.monthlyFee, adjustment_fee: quote.adjustmentFee, vat_excluded: true, breakdown: quote.breakdown }
}

/**
 * Confirms the business number a contract is for, fixing it on first use.
 *
 * @throws {DomainError} `NOT_FOUND` when the number does not match the contract.
 */
export function verifyContractBusiness(deps: ServiceDeps, contractId: string, rawBusinessNumber: string): Record<string, unknown> {
  const contract = requireOpenContract(deps, contractId)
  const businessNumber = requireBusinessNumber(rawBusinessNumber)
  if (contract.business_number !== null && contract.business_number !== businessNumber) throw notFound('Contract')
  if (contract.status === 'draft') {
    updateContract(deps.db, contractId, { business_number: businessNumber, status: 'identity_verified', identity_verified_at: deps.clock.now() })
  }
  return { contract_id: contractId, business_number: businessNumber, status: requireOpenContract(deps, contractId).status }
}

/**
 * Sends a 6-digit verification code to the representative's phone.
 *
 * @throws {DomainError} `INVALID_TRANSITION` before the business number is confirmed or after the SMS step.
 */
export async function sendContractSms(deps: PlatformDeps, contractId: string, phone: string): Promise<void> {
  const contract = requireOpenContract(deps, contractId)
  assertStatus(contract, ['identity_verified'])
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  const now = deps.clock.now()
  insertSmsVerification(deps.db, {
    id: newId('sms'),
    purpose: SMS_PURPOSE,
    targetId: contractId,
    phone: normalizePhone(phone),
    codeHash: sha256Hex(`${contractId}:${code}`),
    now,
    expiresAt: addSeconds(now, SMS_TTL_SECONDS),
  })
  await deps.messenger.sendSms({ to: normalizePhone(phone), template: 'direct_contract_verification', data: { code } })
}

/**
 * Checks the SMS code and moves the contract to `sms_verified`.
 *
 * @throws {DomainError} `VALIDATION_FAILED` on `code` for wrong, expired or exhausted codes.
 */
export function verifyContractSms(deps: ServiceDeps, contractId: string, phone: string, code: string): Record<string, unknown> {
  const contract = requireOpenContract(deps, contractId)
  assertStatus(contract, ['identity_verified'])
  const verification = findLatestSmsVerification(deps.db, SMS_PURPOSE, contractId)
  const now = deps.clock.now()
  if (verification === undefined || verification.phone !== normalizePhone(phone)) throw invalidField('phone_number', 'Request a verification code first.')
  if (verification.attempts >= SMS_MAX_ATTEMPTS || !isBefore(now, verification.expires_at)) throw invalidField('code', 'The code has expired; request a new one.')
  const matches = verification.code_hash === sha256Hex(`${contractId}:${code}`)
  recordSmsAttempt(deps.db, verification.id, matches ? now : null)
  if (!matches) throw invalidField('code', 'The verification code is incorrect.')
  updateContract(deps.db, contractId, { status: 'sms_verified', sms_verified_at: now, representative_phone: normalizePhone(phone) })
  return { contract_id: contractId, status: 'sms_verified' }
}

/** Stores the customer's details and returns the contract to review. */
export function requestContractForm(deps: ServiceDeps, contractId: string, form: ContractForm): Record<string, unknown> {
  const contract = requireOpenContract(deps, contractId)
  assertStatus(contract, ['sms_verified', 'form_requested'])
  updateContract(deps.db, contractId, { status: 'form_requested', form: JSON.stringify(form), form_requested_at: deps.clock.now() })
  return renderContract(requireOpenContract(deps, contractId))
}

/**
 * Signs the contract and starts the tax subscription when the company is already registered.
 *
 * Otherwise the contract waits as `signed` and {@linkcode activateSignedContract}
 * starts the subscription when the company registers.
 *
 * @throws {DomainError} `VALIDATION_FAILED` without the signature or required contract terms.
 */
export function signContract(
  deps: ServiceDeps & { taxTermsVersion: string },
  contractId: string,
  input: { signature: string; agreements: AgreementInput[]; email?: string | undefined },
  client: SessionClient,
): Record<string, unknown> {
  const contract = requireOpenContract(deps, contractId)
  assertStatus(contract, ['form_requested'])
  assertRequiredTermsAnswered(deps, CONTRACT_PURPOSE, input.agreements)
  const form = contract.form === null ? null : (JSON.parse(contract.form) as ContractForm)
  const email = input.email ?? form?.email
  if (email !== undefined) recordAgreements(deps, { email }, input.agreements, client, deps.taxTermsVersion)
  updateContract(deps.db, contractId, { status: 'signed', signature: input.signature, signed_at: deps.clock.now(), effective_on: deps.clock.today() })
  const company = contract.business_number === null ? undefined : findCompanyByBusinessNumber(deps.db, contract.business_number)
  if (company !== undefined) transaction(deps.db, () => activateSignedContract(deps, company))
  return renderContract(requireOpenContract(deps, contractId))
}

/**
 * Links a signed contract to its newly registered company and starts the tax subscription.
 *
 * Runs inside the caller's transaction.
 *
 * @returns Whether a contract was activated.
 */
export function activateSignedContract(deps: ServiceDeps, company: CompanyProfileRow): boolean {
  const contract = findSignedContractForBusiness(deps.db, company.business_number.replace(/-/g, ''))
  if (contract === undefined) return false
  updateContract(deps.db, contract.id, { company_id: company.id, status: 'active' })
  applySubscriptionChange(deps, company.id, 'tax', {
    status: 'active',
    startedOn: contract.effective_on ?? deps.clock.today(),
    endedOn: null,
    monthlyFee: contract.monthly_fee,
    contractId: contract.id,
  })
  return true
}

/**
 * Checks a signup invitation token for the `/join` page.
 *
 * @throws {DomainError} `NOT_FOUND` for unknown, expired, revoked or completed invitations.
 */
export function checkSignupInvitation(deps: ServiceDeps, token: string): Record<string, unknown> {
  const invitation = requireUsableSignupInvitation(deps, token)
  return { exists: true, email: maskEmail(invitation.email), company_name: invitation.company_name, status: invitation.status }
}

/**
 * Confirms the invited email and opens a signup session.
 *
 * @throws {DomainError} `VALIDATION_FAILED` when the email differs from the invitation.
 */
export function verifySignupEmail(deps: ServiceDeps, token: string, email: string): Record<string, unknown> {
  const invitation = requireUsableSignupInvitation(deps, token)
  if (normalizeEmail(email) !== normalizeEmail(invitation.email)) throw invalidField('email', 'Enter the email the invitation was sent to.')
  const id = newId('ss')
  const now = deps.clock.now()
  transaction(deps.db, () => {
    insertSignupSession(deps.db, { id, invitationId: invitation.id, email: invitation.email, now })
    if (invitation.status === 'issued') updateSignupInvitation(deps.db, invitation.id, { status: 'email_verified' })
  })
  return { signup_session: id, email: invitation.email }
}

/**
 * Records the contract agreements of a signup session.
 *
 * @throws {DomainError} `NOT_FOUND` for unknown sessions or `VALIDATION_FAILED` for missing required terms.
 */
export function agreeSignupContract(
  deps: ServiceDeps & { taxTermsVersion: string },
  sessionId: string,
  agreements: AgreementInput[],
  client: SessionClient,
): Record<string, unknown> {
  const session = findSignupSession(deps.db, sessionId)
  if (session === undefined) throw notFound('Signup session')
  const invitation = findSignupInvitation(deps.db, session.invitation_id)
  if (invitation === undefined || !isUsable(invitation, deps.clock.now())) throw new DomainError('GONE', 'The invitation is no longer valid.')
  assertRequiredTermsAnswered(deps, CONTRACT_PURPOSE, agreements)
  recordAgreements(deps, { email: invitation.email }, agreements, client, deps.taxTermsVersion)
  transaction(deps.db, () => {
    recordSignupAgreements(deps.db, sessionId, JSON.stringify(agreements), deps.clock.now())
    updateSignupInvitation(deps.db, invitation.id, { status: 'agreed' })
  })
  return { signup_session: sessionId, status: 'agreed' }
}

/**
 * Creates the invited user, or connects the signed-in user with the invited email.
 *
 * @throws {DomainError} `INVALID_TRANSITION` before the contract agreements,
 * `UNAUTHENTICATED`/`PERMISSION_DENIED` for existing accounts, or `VALIDATION_FAILED`.
 */
export function signupByInvitation(
  deps: ServiceDeps & { taxTermsVersion: string },
  token: string,
  input: { password?: string | undefined; confirm_password?: string | undefined; name?: string | undefined; phone?: string | undefined; agreements?: AgreementInput[] | undefined },
  signedIn: AuthUser | null,
  client: SessionClient,
): { user: UserRow; created: boolean; session: IssuedSession | null } {
  const invitation = requireUsableSignupInvitation(deps, token)
  if (invitation.status !== 'agreed') throw new DomainError('INVALID_TRANSITION', 'Agree to the contract before creating the account.')
  const existing = findUserByEmail(deps.db, invitation.email)
  if (existing !== undefined) {
    if (signedIn === null) throw new DomainError('UNAUTHENTICATED', 'Sign in with the invited email to continue.')
    if (signedIn.id !== existing.id) throw new DomainError('PERMISSION_DENIED', 'This invitation was sent to another email.')
    updateSignupInvitation(deps.db, invitation.id, { user_id: existing.id })
    return { user: existing, created: false, session: null }
  }
  assertNewPassword(input.password ?? '', input.confirm_password ?? '')
  assertRequiredTermsAnswered(deps, 'signup', input.agreements ?? [])
  const userId = newId('u')
  const now = deps.clock.now()
  transaction(deps.db, () => {
    insertUser(deps.db, {
      id: userId,
      email: invitation.email,
      userType: USER_TYPE.client,
      passwordHash: hashPassword(input.password ?? ''),
      name: input.name ?? null,
      phone: input.phone ?? null,
      createdAt: now,
    })
    updateSignupInvitation(deps.db, invitation.id, { user_id: userId })
  })
  recordAgreements(deps, { userId }, input.agreements ?? [], client, deps.taxTermsVersion)
  const user = findUser(deps.db, userId)
  if (user === undefined) throw notFound('User')
  return { user, created: true, session: createSession(deps, userId, false, client) }
}

/**
 * Registers the invited company for the signed-in user and starts its tax subscription.
 *
 * Values missing from the body come from the invitation. The company is
 * linked to the inviting agency and becomes a taxation customer, so the tax
 * terms gate applies from the next request.
 *
 * @throws {DomainError} `PERMISSION_DENIED` unless the invited user is signed in.
 */
export function registerCompanyByInvitation(
  deps: ServiceDeps,
  token: string,
  user: AuthUser,
  input: { name?: string | undefined; business_number?: string | undefined; business_type?: 'corporate' | 'individual' | undefined; phone?: string | undefined; representative_name?: string | undefined },
): CompanyProfileRow {
  const invitation = requireUsableSignupInvitation(deps, token)
  if (invitation.user_id !== user.id) throw new DomainError('PERMISSION_DENIED', 'Create the account from this invitation first.')
  const name = input.name ?? invitation.company_name
  const businessType = input.business_type ?? invitation.business_type
  if (name === null || name === undefined) throw invalidField('name', 'Enter the company name.')
  if (businessType === null || businessType === undefined) throw invalidField('business_type', 'Choose corporation or sole proprietor.')
  const businessNumber = requireBusinessNumber(input.business_number ?? invitation.business_number ?? '')
  return transaction(deps.db, () => {
    const company = registerCompany(deps, {
      name,
      businessNumber,
      businessType,
      phone: input.phone ?? null,
      representativeName: input.representative_name ?? null,
      createdBy: user.id,
      agencyId: invitation.agency_id,
    })
    updateSignupInvitation(deps.db, invitation.id, { status: 'completed', company_id: company.id, used_at: deps.clock.now() })
    const contract = invitation.contract_id === null ? undefined : findContract(deps.db, invitation.contract_id)
    if (!activateSignedContract(deps, company)) {
      applySubscriptionChange(deps, company.id, 'tax', { status: 'active', startedOn: deps.clock.today(), endedOn: null, monthlyFee: contract?.monthly_fee ?? 0, contractId: contract?.id ?? null })
    }
    return company
  })
}

function requireOpenContract(deps: ServiceDeps, contractId: string): ContractRow {
  const contract = findContract(deps.db, contractId)
  if (contract === undefined) throw notFound('Contract')
  if (isContractExpired(contract, deps.clock.now())) {
    if (contract.status !== 'expired') updateContract(deps.db, contractId, { status: 'expired' })
    throw new DomainError('GONE', 'The contract link has expired.')
  }
  return contract
}

function assertStatus(contract: ContractRow, allowed: readonly ContractStatus[]): void {
  if (!allowed.includes(contract.status)) throw new DomainError('INVALID_TRANSITION', `The contract is ${contract.status}.`)
}

function requireUsableSignupInvitation(deps: ServiceDeps, token: string): SignupInvitationRow {
  const invitation = findSignupInvitationByHash(deps.db, sha256Hex(token))
  if (invitation === undefined || !isUsable(invitation, deps.clock.now())) throw notFound('Signup invitation')
  return invitation
}

function isUsable(invitation: SignupInvitationRow, now: string): boolean {
  return ['issued', 'email_verified', 'agreed'].includes(invitation.status) && isBefore(now, invitation.expires_at)
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '')
}
