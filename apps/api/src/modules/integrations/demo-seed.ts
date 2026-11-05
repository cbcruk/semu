import type { Id } from '../../shared/ids/ids.types.ts'
import { DEMO_COMPANY_IDS, DEMO_USER_IDS } from '../identity-access/identity-access.public.ts'
import type { CertificateRecord } from './certificates/certificate.ts'
import type { CertificateCompany } from './certificates/certificate-eligibility.types.ts'
import { DEMO_VAULT_KEY, sealSecret } from './credentials/credential-vault.ts'
import type { DelegationRecord } from './hometax-delegations/hometax-delegation.ts'
import type { IntegrationRecord } from './integrations/integration.ts'
import { hashChannelToken } from './messenger-channels/messenger-channel.ts'
import type { ChannelTokenRecord } from './messenger-channels/messenger-channel.ts'

/** 데모 인증서의 서명 비밀번호입니다. */
export const DEMO_SIGN_PASSWORD = 'demo-sign-1234'

/** 데모 연동·인증서 ID입니다. */
export const DEMO_INTEGRATION_IDS = {
  /** 법인의 홈택스 ID 연동입니다. */
  hometax: 'int_01JBQ000000000000000000001' as Id<'integration'>,
  /** 법인의 은행 ID 연동(계좌 둘)입니다. */
  bank: 'int_01JBQ000000000000000000002' as Id<'integration'>,
  /** 법인의 사업자 범용 인증서입니다. */
  certificate: 'crt_01JBQ000000000000000000001' as Id<'certificate'>,
} as const

/** 데모 상담 채널 토큰입니다. 각각 유효, 사용됨, 만료입니다. */
export const DEMO_CHANNEL_TOKENS = { valid: 'demo-kakao-token', used: 'demo-used-token', expired: 'demo-expired-token' }

const CREATED_AT = '2026-01-02T00:00:00.000Z'

/** 인증서 명의 확인에 쓰는 데모 회사 정보입니다. Identity & Access의 데모 회사와 같습니다. */
export function demoCompanyProfiles(): Array<readonly [Id<'company'>, CertificateCompany]> {
  const profile = (businessNumber: string, businessType: CertificateCompany['businessType']): CertificateCompany => ({
    businessNumber,
    businessType,
    representativeNames: ['김대표'],
  })
  return [
    [DEMO_COMPANY_IDS.corporation, profile('1238145600', 'CORPORATION')],
    [DEMO_COMPANY_IDS.individual, profile('2208162517', 'INDIVIDUAL')],
    [DEMO_COMPANY_IDS.free, profile('1048145235', 'INDIVIDUAL')],
    [DEMO_COMPANY_IDS.demo, profile('1018100340', 'CORPORATION')],
  ]
}

/** 법인의 사업자 범용 인증서입니다. */
export function demoCertificates(): CertificateRecord[] {
  return [
    {
      id: DEMO_INTEGRATION_IDS.certificate,
      companyId: DEMO_COMPANY_IDS.corporation,
      name: '주식회사 세무',
      oid: '1.2.410.200005.1.1.5',
      ownerType: 'BUSINESS',
      usage: 'GENERAL',
      issuerCode: 'yessign',
      serialNumber: 'DEMO-0001',
      issuedOn: '2026-01-02',
      expiresOn: '2099-12-31',
      storedStatus: 'ACTIVE',
      secret: sealSecret(DEMO_VAULT_KEY, { bundle: 'demo-bundle', signPassword: DEMO_SIGN_PASSWORD }),
      registeredBy: DEMO_USER_IDS.owner,
      registeredAt: CREATED_AT,
    },
  ]
}

/** 법인의 홈택스 ID 연동과 은행 ID 연동입니다. */
export function demoIntegrations(): IntegrationRecord[] {
  return [
    {
      id: DEMO_INTEGRATION_IDS.hometax,
      companyId: DEMO_COMPANY_IDS.corporation,
      type: 'HOMETAX',
      authMethod: 'ID_PASSWORD',
      isCorporate: true,
      accountId: 'semu-hometax',
      credential: sealSecret(DEMO_VAULT_KEY, { password: 'hometax-1234' }),
      items: [],
      canIssueTaxInvoice: false,
      usableForTaxFiling: true,
      createdAt: CREATED_AT,
      version: 1,
    },
    {
      id: DEMO_INTEGRATION_IDS.bank,
      companyId: DEMO_COMPANY_IDS.corporation,
      type: 'BANK',
      institutionCode: '004',
      authMethod: 'ID_PASSWORD',
      isCorporate: true,
      accountId: 'semu-bank',
      credential: sealSecret(DEMO_VAULT_KEY, { password: 'bank-1234' }),
      items: [
        {
          key: '004-1',
          kind: 'ACCOUNT',
          institutionCode: '004',
          name: '입출금 1',
          numberMasked: '****1111',
          isActive: true,
        },
        {
          key: '004-2',
          kind: 'ACCOUNT',
          institutionCode: '004',
          name: '입출금 2',
          numberMasked: '****2222',
          isActive: true,
        },
      ],
      canIssueTaxInvoice: false,
      usableForTaxFiling: true,
      createdAt: CREATED_AT,
      version: 1,
    },
  ]
}

/** 법인은 수임동의를 마쳤고, 개인 회사는 동의를 기다립니다. */
export function demoDelegations(): DelegationRecord[] {
  return [
    {
      id: 'dlg_01JBQ000000000000000000001' as Id<'hometaxDelegation'>,
      companyId: DEMO_COMPANY_IDS.corporation,
      agencyName: '세무법인 혜움',
      status: 'AGREED',
      requestedAt: CREATED_AT,
      agreedAt: CREATED_AT,
      agreedBy: DEMO_USER_IDS.owner,
    },
    {
      id: 'dlg_01JBQ000000000000000000002' as Id<'hometaxDelegation'>,
      companyId: DEMO_COMPANY_IDS.individual,
      agencyName: '세무법인 혜움',
      status: 'REQUESTED',
      requestedAt: CREATED_AT,
    },
  ]
}

/** 메신저 브리지가 발급했다고 가정한 연결 토큰입니다. */
export function demoChannelTokens(): ChannelTokenRecord[] {
  const farFuture = Date.parse('2099-12-31T00:00:00Z')
  const past = Date.parse('2026-01-01T00:00:00Z')
  return [
    {
      tokenHash: hashChannelToken(DEMO_CHANNEL_TOKENS.valid),
      messengerType: 'KAKAOTALK',
      channelName: '혜움상담',
      expiresAt: farFuture,
    },
    {
      tokenHash: hashChannelToken(DEMO_CHANNEL_TOKENS.used),
      messengerType: 'SLACK',
      channelName: '#semu-tax',
      expiresAt: farFuture,
      usedAt: past,
      usedBy: DEMO_USER_IDS.owner,
      companyId: DEMO_COMPANY_IDS.corporation,
    },
    {
      tokenHash: hashChannelToken(DEMO_CHANNEL_TOKENS.expired),
      messengerType: 'SLACK',
      channelName: '#old',
      expiresAt: past,
    },
  ]
}
