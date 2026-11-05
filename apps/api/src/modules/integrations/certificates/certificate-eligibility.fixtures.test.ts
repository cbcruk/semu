import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { InstitutionType } from '../institutions/institution.ts'
import { decideRegistration } from '../integrations/registration-limits.ts'
import {
  CERTIFICATE_OIDS,
  certificateStatus,
  decideCertificateRegistration,
  isCertificateUsableFor,
  remainingDays,
} from './certificate-eligibility.ts'
import type { CertificateOwnerType, CertificateUsage } from './certificate-eligibility.types.ts'

/**
 * 현행 픽스처(`test/fixtures/rules/certificate-eligibility.json`)를 서버 인증서 규칙으로 옮긴 테스트입니다.
 *
 * 현행 값(`business`/`personal`, `general`/`bank`/`etax`, snake_case 필드)을 재설계 enum과 camelCase로 바꿔 비교합니다.
 */

interface FixtureCase {
  name: string
  input: Record<string, any>
  expected: any
}

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../../../test/fixtures/rules/certificate-eligibility.json'), 'utf8'),
) as { cases: FixtureCase[] }

const FIELDS: Record<string, string> = {
  oid: 'oid',
  end_date: 'expiresOn',
  owner_name: 'ownerName',
  owner_business_number: 'ownerBusinessNumber',
}

const SERVICES: Record<string, InstitutionType> = {
  hometax: 'HOMETAX',
  giro: 'GIRO',
  bank: 'BANK',
  creditcard: 'CREDIT_CARD',
  cardsales: 'CARD_SALES',
}

const ownerType = (value: string): CertificateOwnerType => (value === 'business' ? 'BUSINESS' : 'PERSONAL')
const usage = (value: string): CertificateUsage => value.toUpperCase() as CertificateUsage

const byCheck = (check: string) => fixture.cases.filter((testCase) => testCase.input['check'] === check)

describe('certificate-eligibility fixture', () => {
  it.each(byCheck('register').map((testCase) => [testCase.name, testCase] as const))('%s', (_, testCase) => {
    const { company, certificate, today } = testCase.input
    const decision = decideCertificateRegistration(
      {
        businessType: company.businessType,
        businessNumber: company.businessNumber,
        representativeNames: company.representatives,
      },
      {
        oid: certificate.oid,
        expiresOn: certificate.endDate,
        ...(certificate.ownerBusinessNumber === undefined
          ? {}
          : { ownerBusinessNumber: certificate.ownerBusinessNumber }),
        ...(certificate.ownerName === undefined ? {} : { ownerName: certificate.ownerName }),
      },
      today,
    )

    if (testCase.expected.ok) {
      expect(decision).toMatchObject({
        ok: true,
        ownerType: ownerType(testCase.expected.certType),
        usage: usage(testCase.expected.usage),
        ...(testCase.expected.organizationCode === undefined ? {} : { issuerCode: testCase.expected.organizationCode }),
      })
    } else {
      expect(decision).toMatchObject({ ok: false, rejection: { field: FIELDS[testCase.expected.field] } })
    }
  })

  const useFor = byCheck('useFor').filter((testCase) => testCase.input['service'] !== 'taxFilingHometax')

  it.each(useFor.map((testCase) => [testCase.name, testCase] as const))('%s', (_, testCase) => {
    const { service, company, certificate } = testCase.input
    const allowed = isCertificateUsableFor(SERVICES[service]!, company.businessType, {
      ownerType: ownerType(certificate.certType),
      usage: usage(certificate.usage),
    })

    expect(allowed).toBe(testCase.expected === true)
  })

  it('tax filing (세무신고 기관 연동) cannot use certificate integrations', () => {
    const decision = decideRegistration(
      { type: 'HOMETAX', authMethod: 'CERTIFICATE', institutionCodes: [], isCorporate: true, newItemCount: 0 },
      { integrations: [], itemCount: 0 },
    )

    expect(decision).toMatchObject({ ok: true, usableForTaxFiling: false })
  })

  it.each(byCheck('status').map((testCase) => [testCase.name, testCase] as const))('%s', (_, testCase) => {
    const { certificate, today } = testCase.input
    const status = certificateStatus(
      { status: certificate.status, expiresOn: certificate.endDate, deleted: certificate.deleted },
      today,
    )

    expect(status).toBe(testCase.expected.status)
    if (testCase.expected.isActive !== undefined) expect(status === 'ACTIVE').toBe(testCase.expected.isActive)
    if (testCase.expected.remainingDays !== undefined) {
      expect(remainingDays(certificate.endDate, today)).toBe(testCase.expected.remainingDays)
    }
  })

  it('classify: label shown on the certificate card', () => {
    expect(CERTIFICATE_OIDS['1.2.410.200005.1.1.4']).toEqual({
      ownerType: 'PERSONAL',
      usage: 'BANK',
      issuerCode: 'yessign',
    })
  })

  it('ports every case', () => {
    const ported = [...byCheck('register'), ...byCheck('useFor'), ...byCheck('status'), ...byCheck('classify')].map(
      (testCase) => testCase.name,
    )

    expect(ported.sort()).toEqual(fixture.cases.map((testCase) => testCase.name).sort())
  })
})
