import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { MAX_ITEMS_PER_TYPE } from '../institutions/institution.ts'
import { integrationView } from './integrations.ts'
import { decideRegistration } from './registration-limits.ts'
import type { ExistingLinks, RegistrationDecision, RegistrationRequest } from './registration-limits.types.ts'

/**
 * 현행 픽스처(`test/fixtures/rules/integration-registration-limits.json`)를 서버 등록 규칙으로 옮긴 테스트입니다.
 *
 * 현행 입력(snake_case 본문, 카드사 이름)을 재설계 요청으로 바꾸고, 결정
 * (`docs/design/rule-decisions/integrations.md`의 integration-registration-limits)에 따라 기대값을 정합니다.
 * 형식이 아닌 규칙 위반은 400이 아니라 422(한도·인증 방법)와 409(중복·새 항목 없음)입니다.
 */

interface FixtureCase {
  name: string
  input: Record<string, unknown>
  expected: Record<string, unknown>
}

const fixture = JSON.parse(
  readFileSync(
    join(import.meta.dirname, '../../../../test/fixtures/rules/integration-registration-limits.json'),
    'utf8',
  ),
) as { cases: FixtureCase[] }

const NONE: ExistingLinks = { integrations: [], itemCount: 0 }

function pgLinks(count: number): ExistingLinks {
  return {
    integrations: Array.from({ length: count }, (_, index) => ({
      type: 'PG' as const,
      authMethod: 'API_KEY' as const,
      institutionCode: 'HECTO',
      accountKey: `h${index + 1}`,
    })),
    itemCount: 0,
  }
}

function request(
  overrides: Partial<RegistrationRequest> & Pick<RegistrationRequest, 'type' | 'authMethod'>,
): RegistrationRequest {
  return { institutionCodes: [], isCorporate: true, newItemCount: 0, ...overrides }
}

/** 케이스 이름 → 재설계 요청, 기존 연동, 서버 기대값입니다. */
const PORTED: Record<string, () => [RegistrationRequest, ExistingLinks, Partial<RegistrationDecision> | object]> = {
  'bank: 19 accounts registered, adding 1 is accepted': () => [
    request({ type: 'BANK', authMethod: 'ID_PASSWORD', institutionCodes: ['004'], newItemCount: 1 }),
    { integrations: [], itemCount: 19 },
    { ok: true },
  ],
  'bank: 19 accounts registered, adding 2 exceeds 20': () => [
    request({ type: 'BANK', authMethod: 'ID_PASSWORD', institutionCodes: ['004'], newItemCount: 2 }),
    { integrations: [], itemCount: 19 },
    { ok: false, violation: { code: 'ITEM_LIMIT_EXCEEDED', field: 'itemKeys', limit: 20 } },
  ],
  'creditcard: selecting only already registered cards is refused': () => [
    request({ type: 'CREDIT_CARD', authMethod: 'ID_PASSWORD', institutionCodes: ['001'], newItemCount: 0 }),
    { integrations: [], itemCount: 3 },
    { ok: false, violation: { code: 'NO_NEW_ITEMS', field: 'itemKeys' } },
  ],
  'creditcard: ID login with two card companies at once is refused': () => [
    request({ type: 'CREDIT_CARD', authMethod: 'ID_PASSWORD', institutionCodes: ['001', '002'], newItemCount: 1 }),
    NONE,
    { ok: false, violation: { code: 'SINGLE_INSTITUTION_REQUIRED', field: 'institutionCodes' } },
  ],
  'creditcard: corporate 하나·롯데·삼성 cards only via ID/PW': () => [
    request({
      type: 'CREDIT_CARD',
      authMethod: 'CERTIFICATE',
      institutionCodes: ['HANA', 'LOTTE', 'SAMSUNG'],
      newItemCount: 3,
    }),
    NONE,
    { ok: false, violation: { code: 'AUTH_METHOD_NOT_SUPPORTED', field: 'certificateId' } },
  ],
  'pg: TOSSPAYMENTS MID starting with CF_ is refused': () => [
    request({
      type: 'PG',
      authMethod: 'API_KEY',
      institutionCodes: ['TOSSPAYMENTS'],
      mid: 'CF_shop01',
      keyNames: ['secretKey'],
    }),
    NONE,
    { ok: false, violation: { code: 'PG_MID_NOT_SUPPORTED', field: 'mid' } },
  ],
  'pg: CF_ prefix on another PG company is not checked': () => [
    request({
      type: 'PG',
      authMethod: 'API_KEY',
      institutionCodes: ['KSNET'],
      mid: 'CF_shop01',
      keyNames: ['reconciliationApiKey'],
    }),
    NONE,
    { ok: true },
  ],
  'pg: NAVERPAY needs settlement_api_key, client_id, client_secret and chain_id': () => [
    request({
      type: 'PG',
      authMethod: 'API_KEY',
      institutionCodes: ['NAVERPAY'],
      mid: 'np01',
      keyNames: ['settlementApiKey', 'clientId'],
    }),
    NONE,
    {
      ok: false,
      violation: { code: 'PG_KEY_MISSING', field: 'keys.clientSecret', missing: ['clientSecret', 'chainId'] },
    },
  ],
  'pg: NICEPAY needs usr_id and merchant_key; secret keys are masked in responses': () => [
    request({
      type: 'PG',
      authMethod: 'API_KEY',
      institutionCodes: ['NICEPAY'],
      mid: 'nice01',
      keyNames: ['usrId', 'merchantKey'],
    }),
    NONE,
    { ok: true, ipWhitelist: '52.78.5.241' },
  ],
  'pg: same PG company with a second MID (단건 + 정기) is a separate link': () => [
    request({
      type: 'PG',
      authMethod: 'API_KEY',
      institutionCodes: ['TOSSPAYMENTS'],
      mid: 'billing01',
      keyNames: ['secretKey'],
    }),
    {
      integrations: [{ type: 'PG', authMethod: 'API_KEY', institutionCode: 'TOSSPAYMENTS', accountKey: 'single01' }],
      itemCount: 0,
    },
    { ok: true },
  ],
  'pg: same PG company and MID again is a conflict': () => [
    request({
      type: 'PG',
      authMethod: 'API_KEY',
      institutionCodes: ['TOSSPAYMENTS'],
      mid: 'single01',
      keyNames: ['secretKey'],
    }),
    {
      integrations: [{ type: 'PG', authMethod: 'API_KEY', institutionCode: 'TOSSPAYMENTS', accountKey: 'single01' }],
      itemCount: 0,
    },
    { ok: false, violation: { code: 'INTEGRATION_DUPLICATE' } },
  ],
  'pg: 20 MIDs registered, the 21st is refused': () => [
    request({ type: 'PG', authMethod: 'API_KEY', institutionCodes: ['HECTO'], mid: 'h21', keyNames: ['licenseKey'] }),
    pgLinks(20),
    { ok: false, violation: { code: 'ITEM_LIMIT_EXCEEDED', field: 'mid', limit: 20 } },
  ],
  'delivery: account whose stores are all registered is a conflict': () => [
    request({ type: 'DELIVERY', authMethod: 'ID_PASSWORD', institutionCodes: ['BAEMIN'], newItemCount: 0 }),
    { integrations: [], itemCount: 2 },
    { ok: false, violation: { code: 'NO_NEW_ITEMS', field: 'itemKeys' } },
  ],
  'delivery: certificate login is not accepted': () => [
    request({ type: 'DELIVERY', authMethod: 'CERTIFICATE', institutionCodes: ['YOGIYO'], newItemCount: 1 }),
    NONE,
    { ok: false, violation: { code: 'AUTH_METHOD_NOT_SUPPORTED', field: 'certificateId' } },
  ],
  'giro: ID/PW login is refused, a certificate is required': () => [
    request({ type: 'GIRO', authMethod: 'ID_PASSWORD' }),
    NONE,
    { ok: false, violation: { code: 'AUTH_METHOD_NOT_SUPPORTED', field: 'authMethod' } },
  ],
  'giro: giro_id/giro_pw passed for signup or first login are not stored': () => [
    request({ type: 'GIRO', authMethod: 'CERTIFICATE' }),
    NONE,
    { ok: true, canIssueTaxInvoice: false },
  ],
  'hometax: ID/PW link allows lookup only': () => [
    request({ type: 'HOMETAX', authMethod: 'ID_PASSWORD' }),
    NONE,
    { ok: true, canIssueTaxInvoice: false },
  ],
  'hometax: certificate link allows tax invoice issuing and may coexist with an ID link': () => [
    request({ type: 'HOMETAX', authMethod: 'CERTIFICATE' }),
    { integrations: [{ type: 'HOMETAX', authMethod: 'ID_PASSWORD' }], itemCount: 0 },
    { ok: true, canIssueTaxInvoice: true },
  ],
  'hometax: second ID link is a conflict': () => [
    request({ type: 'HOMETAX', authMethod: 'ID_PASSWORD' }),
    { integrations: [{ type: 'HOMETAX', authMethod: 'ID_PASSWORD' }], itemCount: 0 },
    { ok: false, violation: { code: 'INTEGRATION_DUPLICATE' } },
  ],
  'speedbank: 신한은행 registers through the speed lookup account, not internet banking ID': () => [
    request({ type: 'SPEED_BANK', authMethod: 'SPEED_LOOKUP', institutionCodes: ['088'], accountId: 'quick' }),
    NONE,
    { ok: true, usableForTaxFiling: true },
  ],
}

describe('기관 연동 등록 제한 규칙 픽스처', () => {
  it.each(Object.keys(PORTED))('%s', (name) => {
    const [input, existing, expected] = PORTED[name]!()

    expect(decideRegistration(input, existing)).toMatchObject(expected)
  })

  it('현행처럼 기관 종류마다 20개까지 등록합니다', () => {
    expect(MAX_ITEMS_PER_TYPE).toBe(20)
  })

  it('PG 비밀 키는 가리고 공개 키는 그대로 보여 줍니다', () => {
    const view = integrationView(
      {
        id: 'int_01JBQ000000000000000000099' as Id<'integration'>,
        companyId: 'cmp_01JBQ000000000000000000001' as Id<'company'>,
        type: 'PG',
        institutionCode: 'NICEPAY',
        authMethod: 'API_KEY',
        isCorporate: true,
        accountId: 'nice01',
        publicKeys: { usrId: 'admin' },
        secretKeyNames: ['merchantKey'],
        items: [],
        canIssueTaxInvoice: false,
        usableForTaxFiling: false,
        ipWhitelist: '52.78.5.241',
        createdAt: '2026-11-01T00:00:00.000Z',
        version: 1,
      },
      undefined,
    )

    expect(view.keys).toEqual({ usrId: 'admin', merchantKey: '********' })
  })

  it('모든 케이스를 옮깁니다', () => {
    expect(fixture.cases.map((testCase) => testCase.name).sort()).toEqual(Object.keys(PORTED).sort())
  })
})
