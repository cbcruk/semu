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

function 거절(violation: RegistrationViolation): RegistrationDecision {
  return { ok: false, violation }
}

function 인증방법필드(method: AuthMethod): string {
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
    return 거절({ code: 'AUTH_METHOD_NOT_SUPPORTED', field: 인증방법필드(request.authMethod) })
  }
  if (
    request.type === 'CREDIT_CARD' &&
    request.isCorporate &&
    request.authMethod === 'CERTIFICATE' &&
    request.institutionCodes.some((카드사코드) => ID_ONLY_CORPORATE_CARD_COMPANIES.has(카드사코드))
  ) {
    return 거절({ code: 'AUTH_METHOD_NOT_SUPPORTED', field: 'certificateId' })
  }
  if (request.authMethod !== 'CERTIFICATE' && request.institutionCodes.length > 1) {
    return 거절({ code: 'SINGLE_INSTITUTION_REQUIRED', field: 'institutionCodes' })
  }
  // 같은종류연동: 이 기관 종류의 기존 연동, 키규격: PG사별 연동키 규격(`PG_KEY_SPECS`)입니다. 지은 말입니다.
  const 같은종류연동 = existing.integrations.filter((연동) => 연동.type === request.type)
  const 기관코드 = request.institutionCodes[0]
  switch (request.type) {
    case 'PG': {
      const 키규격 = 기관코드 === undefined ? undefined : PG_KEY_SPECS[기관코드]
      if (키규격 === undefined) return 거절({ code: 'PG_COMPANY_UNKNOWN', field: 'institutionCodes' })
      const 상점아이디 = request.mid ?? ''
      if (기관코드 === 'TOSSPAYMENTS' && 상점아이디.startsWith('CF_'))
        return 거절({ code: 'PG_MID_NOT_SUPPORTED', field: 'mid' })
      const 받은키이름 = new Set(request.keyNames ?? [])
      const 빠진키 = 키규격.required.filter((키) => !받은키이름.has(키))
      const 첫빠진키 = 빠진키[0]
      if (첫빠진키 !== undefined) return 거절({ code: 'PG_KEY_MISSING', field: `keys.${첫빠진키}`, missing: 빠진키 })
      if (같은종류연동.some((연동) => 연동.institutionCode === 기관코드 && 연동.accountKey === 상점아이디)) {
        return 거절({ code: 'INTEGRATION_DUPLICATE' })
      }
      if (같은종류연동.length >= MAX_ITEMS_PER_TYPE) {
        return 거절({ code: 'ITEM_LIMIT_EXCEEDED', field: 'mid', limit: MAX_ITEMS_PER_TYPE })
      }
      return {
        ok: true,
        canIssueTaxInvoice: false,
        usableForTaxFiling: false,
        ...(키규격.ipWhitelist === undefined ? {} : { ipWhitelist: 키규격.ipWhitelist }),
      }
    }
    case 'HOMETAX':
      if (같은종류연동.some((연동) => 연동.authMethod === request.authMethod)) {
        return 거절({ code: 'INTEGRATION_DUPLICATE' })
      }
      return {
        ok: true,
        canIssueTaxInvoice: request.authMethod === 'CERTIFICATE',
        usableForTaxFiling: request.authMethod === 'ID_PASSWORD',
      }
    case 'CARD_SALES':
    case 'GIRO':
      if (같은종류연동.length > 0) return 거절({ code: 'INTEGRATION_DUPLICATE' })
      return { ok: true, canIssueTaxInvoice: false, usableForTaxFiling: request.type === 'CARD_SALES' }
    case 'SPEED_BANK':
      if (같은종류연동.some((연동) => 연동.institutionCode === 기관코드 && 연동.accountKey === request.accountId)) {
        return 거절({ code: 'INTEGRATION_DUPLICATE' })
      }
      return { ok: true, canIssueTaxInvoice: false, usableForTaxFiling: true }
    case 'CREDIT_CARD':
    case 'BANK':
    case 'DELIVERY':
    case 'ALLRA': {
      if (request.newItemCount === 0) return 거절({ code: 'NO_NEW_ITEMS', field: 'itemKeys' })
      if (existing.itemCount + request.newItemCount > MAX_ITEMS_PER_TYPE) {
        return 거절({ code: 'ITEM_LIMIT_EXCEEDED', field: 'itemKeys', limit: MAX_ITEMS_PER_TYPE })
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
