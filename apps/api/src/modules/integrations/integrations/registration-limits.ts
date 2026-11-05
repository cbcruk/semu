import { ID_ONLY_CORPORATE_CARD_COMPANIES, MAX_ITEMS_PER_TYPE, PG_KEY_SPECS } from '../institutions/institution.ts'
import type { AuthMethod, InstitutionType } from '../institutions/institution.ts'
import type {
  ExistingLinks,
  RegistrationDecision,
  RegistrationRequest,
  RegistrationViolation,
} from './registration-limits.types.ts'

/** 기관별로 받는 인증 방법입니다. 매뉴얼에만 있던 제약(지로는 인증서만, 배달은 ID/PW만)을 서버가 검사합니다. */
export const AUTH_METHODS: Readonly<Record<InstitutionType, ReadonlyArray<AuthMethod>>> = {
  HOMETAX: ['ID_PASSWORD', 'CERTIFICATE'],
  CARD_SALES: ['ID_PASSWORD'],
  CREDIT_CARD: ['ID_PASSWORD', 'CERTIFICATE'],
  BANK: ['ID_PASSWORD', 'CERTIFICATE'],
  SPEED_BANK: ['SPEED_LOOKUP'],
  GIRO: ['CERTIFICATE'],
  PG: ['API_KEY'],
  DELIVERY: ['ID_PASSWORD'],
  ALLRA: ['OAUTH'],
}

function reject(violation: RegistrationViolation): RegistrationDecision {
  return { ok: false, violation }
}

function authField(method: AuthMethod): string {
  return method === 'CERTIFICATE' ? 'certificateId' : 'authMethod'
}

/**
 * 새 연동을 등록해도 되는지 판정합니다. 자격 증명이 기관에서 통하는지는 판정하지 않습니다(수집 어댑터의 일).
 *
 * 검사 순서는 인증 방법, 기관 수, PG 키, 중복, 한도입니다. 한도는 카드·계좌·매장은 항목 수, PG는 연동 수로 셉니다.
 *
 * @example PG 21번째 MID
 * ```ts
 * decideRegistration({ type: 'PG', authMethod: 'API_KEY', institutionCodes: ['HECTO'], isCorporate: true, mid: 'h21', keyNames: ['licenseKey'], newItemCount: 0 }, twentyPgLinks)
 * // { ok: false, violation: { code: 'ITEM_LIMIT_EXCEEDED', field: 'mid', limit: 20 } }
 * ```
 */
export function decideRegistration(request: RegistrationRequest, existing: ExistingLinks): RegistrationDecision {
  if (!AUTH_METHODS[request.type].includes(request.authMethod)) {
    return reject({ code: 'AUTH_METHOD_NOT_SUPPORTED', field: authField(request.authMethod) })
  }
  if (
    request.type === 'CREDIT_CARD' &&
    request.isCorporate &&
    request.authMethod === 'CERTIFICATE' &&
    request.institutionCodes.some((code) => ID_ONLY_CORPORATE_CARD_COMPANIES.has(code))
  ) {
    return reject({ code: 'AUTH_METHOD_NOT_SUPPORTED', field: 'certificateId' })
  }
  if (request.authMethod !== 'CERTIFICATE' && request.institutionCodes.length > 1) {
    return reject({ code: 'SINGLE_INSTITUTION_REQUIRED', field: 'institutionCodes' })
  }
  const sameType = existing.integrations.filter((integration) => integration.type === request.type)
  const code = request.institutionCodes[0]
  switch (request.type) {
    case 'PG': {
      const spec = code === undefined ? undefined : PG_KEY_SPECS[code]
      if (spec === undefined) return reject({ code: 'PG_COMPANY_UNKNOWN', field: 'institutionCodes' })
      const mid = request.mid ?? ''
      if (code === 'TOSSPAYMENTS' && mid.startsWith('CF_'))
        return reject({ code: 'PG_MID_NOT_SUPPORTED', field: 'mid' })
      const names = new Set(request.keyNames ?? [])
      const missing = spec.required.filter((key) => !names.has(key))
      const first = missing[0]
      if (first !== undefined) return reject({ code: 'PG_KEY_MISSING', field: `keys.${first}`, missing })
      if (sameType.some((link) => link.institutionCode === code && link.accountKey === mid)) {
        return reject({ code: 'INTEGRATION_DUPLICATE' })
      }
      if (sameType.length >= MAX_ITEMS_PER_TYPE) {
        return reject({ code: 'ITEM_LIMIT_EXCEEDED', field: 'mid', limit: MAX_ITEMS_PER_TYPE })
      }
      return {
        ok: true,
        canIssueTaxInvoice: false,
        usableForTaxFiling: false,
        ...(spec.ipWhitelist === undefined ? {} : { ipWhitelist: spec.ipWhitelist }),
      }
    }
    case 'HOMETAX':
      if (sameType.some((link) => link.authMethod === request.authMethod)) {
        return reject({ code: 'INTEGRATION_DUPLICATE' })
      }
      return {
        ok: true,
        canIssueTaxInvoice: request.authMethod === 'CERTIFICATE',
        usableForTaxFiling: request.authMethod === 'ID_PASSWORD',
      }
    case 'CARD_SALES':
    case 'GIRO':
      if (sameType.length > 0) return reject({ code: 'INTEGRATION_DUPLICATE' })
      return { ok: true, canIssueTaxInvoice: false, usableForTaxFiling: request.type === 'CARD_SALES' }
    case 'SPEED_BANK':
      if (sameType.some((link) => link.institutionCode === code && link.accountKey === request.accountId)) {
        return reject({ code: 'INTEGRATION_DUPLICATE' })
      }
      return { ok: true, canIssueTaxInvoice: false, usableForTaxFiling: true }
    case 'CREDIT_CARD':
    case 'BANK':
    case 'DELIVERY':
    case 'ALLRA': {
      if (request.newItemCount === 0) return reject({ code: 'NO_NEW_ITEMS', field: 'itemKeys' })
      if (existing.itemCount + request.newItemCount > MAX_ITEMS_PER_TYPE) {
        return reject({ code: 'ITEM_LIMIT_EXCEEDED', field: 'itemKeys', limit: MAX_ITEMS_PER_TYPE })
      }
      return {
        ok: true,
        canIssueTaxInvoice: false,
        usableForTaxFiling:
          (request.type === 'CREDIT_CARD' || request.type === 'BANK') && request.authMethod === 'ID_PASSWORD',
      }
    }
  }
}
