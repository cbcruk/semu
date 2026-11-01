import type { AssistantAdapter, AssistantReply, AssistantTurn } from './assistant.adapter'
import type { BillingAdapter, BillingOutcome, MandateRequest, WithdrawalRequest } from './billing.adapter'
import type { BusinessStatus, BusinessStatusAdapter } from './business-status.adapter'
import type { SocialLoginAdapter, SocialProfile, SocialProvider } from './social-login.adapter'

/**
 * Creates a deterministic {@linkcode BillingAdapter}.
 *
 * Accounts ending in `0000` are rejected at mandate registration, and
 * withdrawals from accounts ending in `9999` fail for insufficient funds.
 */
export function createFakeBillingAdapter(): BillingAdapter {
  return {
    registerMandate(request: MandateRequest): Promise<BillingOutcome> {
      return Promise.resolve(request.accountNumber.endsWith('0000') ? { ok: false, reason: 'ACCOUNT_NOT_FOUND' } : { ok: true })
    },
    withdraw(request: WithdrawalRequest): Promise<BillingOutcome> {
      return Promise.resolve(request.accountNumber.endsWith('9999') ? { ok: false, reason: 'INSUFFICIENT_FUNDS' } : { ok: true })
    },
  }
}

/**
 * Creates a deterministic {@linkcode BusinessStatusAdapter}.
 *
 * Numbers starting with `999` are closed, `888` suspended; every other number
 * is a registered general taxpayer.
 */
export function createFakeBusinessStatusAdapter(): BusinessStatusAdapter {
  return {
    lookup(businessNumber: string): Promise<BusinessStatus> {
      if (businessNumber.startsWith('999')) return Promise.resolve({ businessStatus: 'closed', taxationType: null, closedOn: '2025-12-31' })
      if (businessNumber.startsWith('888')) return Promise.resolve({ businessStatus: 'suspended', taxationType: '부가가치세 일반과세자', closedOn: null })
      return Promise.resolve({ businessStatus: 'registered', taxationType: '부가가치세 일반과세자', closedOn: null })
    },
  }
}

/**
 * Creates a deterministic Kakao {@linkcode SocialLoginAdapter}.
 *
 * The code `invalid` fails; codes starting with `noemail` return no email;
 * any other code `x` maps to the provider UID `kakao-x` and email `x@kakao.example`.
 */
export function createFakeSocialLoginAdapter(): SocialLoginAdapter {
  return {
    exchangeCode(_provider: SocialProvider, code: string): Promise<SocialProfile | null> {
      if (code === 'invalid') return Promise.resolve(null)
      return Promise.resolve({
        providerUid: `kakao-${code}`,
        email: code.startsWith('noemail') ? null : `${code}@kakao.example`,
        name: null,
      })
    },
  }
}

/**
 * Creates a deterministic {@linkcode AssistantAdapter} that echoes the message.
 *
 * Messages mentioning `세금계산서` propose the `issue_tax_invoice` tool when it is allowed.
 */
export function createFakeAssistantAdapter(): AssistantAdapter {
  return {
    reply(turn: AssistantTurn): Promise<AssistantReply> {
      const wantsInvoice = turn.message.includes('세금계산서') && turn.allowedTools.includes('issue_tax_invoice')
      return Promise.resolve({
        content: `[${turn.companyName}] ${turn.message}`,
        toolCalls: wantsInvoice ? [{ tool: 'issue_tax_invoice', arguments: {}, requiresConfirmation: true }] : [],
      })
    },
  }
}
