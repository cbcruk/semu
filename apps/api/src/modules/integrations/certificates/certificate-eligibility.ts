import { CERTIFICATE_INSTITUTIONS } from '../institutions/institution.ts'
import type { InstitutionType } from '../institutions/institution.ts'
import type {
  CertificateClass,
  CertificateCompany,
  CertificateFacts,
  CertificateRegistrationDecision,
  CertificateStatus,
} from './certificate-eligibility.types.ts'

/**
 * 공인 발급기관의 인증서 정책 OID 분류표입니다. 현행 클라이언트 표(B:89563)의 일부입니다.
 *
 * KICA·tradesign과 일부 용도가 빠져 있습니다. 운영 전에 참조데이터로 옮기고 전체 표로 채웁니다.
 */
export const CERTIFICATE_OIDS: Readonly<Record<string, CertificateClass>> = {
  '1.2.410.200005.1.1.1': { ownerType: 'PERSONAL', usage: 'GENERAL', issuerCode: 'yessign' },
  '1.2.410.200005.1.1.4': { ownerType: 'PERSONAL', usage: 'BANK', issuerCode: 'yessign' },
  '1.2.410.200005.1.1.5': { ownerType: 'BUSINESS', usage: 'GENERAL', issuerCode: 'yessign' },
  '1.2.410.200005.1.1.2': { ownerType: 'BUSINESS', usage: 'BANK', issuerCode: 'yessign' },
  '1.2.410.200005.1.1.6.2': { ownerType: 'BUSINESS', usage: 'ETAX', issuerCode: 'yessign' },
  '1.2.410.200004.5.1.1.5': { ownerType: 'PERSONAL', usage: 'GENERAL', issuerCode: 'signkorea' },
  '1.2.410.200004.5.1.1.7': { ownerType: 'BUSINESS', usage: 'GENERAL', issuerCode: 'signkorea' },
  '1.2.410.200004.5.2.1.2': { ownerType: 'PERSONAL', usage: 'GENERAL', issuerCode: 'signgate' },
  '1.2.410.200004.5.2.1.1': { ownerType: 'BUSINESS', usage: 'GENERAL', issuerCode: 'signgate' },
  '1.2.410.200004.5.4.1.1': { ownerType: 'PERSONAL', usage: 'GENERAL', issuerCode: 'crosscert' },
  '1.2.410.200004.5.4.1.2': { ownerType: 'BUSINESS', usage: 'GENERAL', issuerCode: 'crosscert' },
}

/**
 * 공동인증서를 이 회사에 등록해도 되는지 판정합니다. 서명 비밀번호와 일련번호 중복은 서비스가 따로 봅니다.
 *
 * 개인사업자는 사업자 명의 인증서 또는 대표자 개인 인증서, 법인은 법인 명의 인증서만 받습니다.
 *
 * @example 다른 사람 명의의 개인 인증서
 * ```ts
 * decideCertificateRegistration(soleProprietor, { oid: '1.2.410.200005.1.1.1', ownerName: '이직원', expiresOn: '2027-03-01' }, '2026-11-01')
 * // { ok: false, rejection: { code: 'CERTIFICATE_OWNER_MISMATCH', field: 'ownerName' } }
 * ```
 */
export function decideCertificateRegistration(
  company: CertificateCompany,
  certificate: CertificateFacts,
  today: string,
): CertificateRegistrationDecision {
  const 인증서분류 = CERTIFICATE_OIDS[certificate.oid]
  if (인증서분류 === undefined) return { ok: false, rejection: { code: 'CERTIFICATE_OID_UNKNOWN', field: 'oid' } }
  if (certificate.expiresOn < today) {
    return { ok: false, rejection: { code: 'CERTIFICATE_EXPIRED', field: 'expiresOn' } }
  }
  if (인증서분류.ownerType === 'BUSINESS') {
    const 명의사업자번호 = (certificate.ownerBusinessNumber ?? '').replaceAll('-', '')
    if (명의사업자번호 !== company.businessNumber) {
      return { ok: false, rejection: { code: 'CERTIFICATE_OWNER_MISMATCH', field: 'ownerBusinessNumber' } }
    }
    return { ok: true, ...인증서분류 }
  }
  if (company.businessType === 'CORPORATION') {
    return { ok: false, rejection: { code: 'CERTIFICATE_TYPE_NOT_ALLOWED', field: 'oid' } }
  }
  if (!company.representativeNames.includes(certificate.ownerName ?? '')) {
    return { ok: false, rejection: { code: 'CERTIFICATE_OWNER_MISMATCH', field: 'ownerName' } }
  }
  return { ok: true, ...인증서분류 }
}

/**
 * 인증서를 이 기관 연동에 쓸 수 있는지 판정합니다.
 *
 * 홈택스는 사업자 범용·전자세금용, 지로·은행·카드사는 법인이면 사업자, 개인사업자면 대표자 개인 명의의 범용·은행용만 씁니다.
 */
export function isCertificateUsableFor(
  institution: InstitutionType,
  businessType: CertificateCompany['businessType'],
  certificate: Pick<CertificateClass, 'ownerType' | 'usage'>,
): boolean {
  if (!CERTIFICATE_INSTITUTIONS.has(institution)) return false
  if (institution === 'HOMETAX') {
    return certificate.ownerType === 'BUSINESS' && (certificate.usage === 'GENERAL' || certificate.usage === 'ETAX')
  }
  const 받는명의 = businessType === 'CORPORATION' ? 'BUSINESS' : 'PERSONAL'
  return certificate.ownerType === 받는명의 && (certificate.usage === 'BANK' || certificate.usage === 'GENERAL')
}

/** 인증서로 연동할 수 있는 기관 목록입니다. 연동 화면의 `가능`/`불가` 표시를 서버가 정합니다. */
export function usableInstitutions(
  businessType: CertificateCompany['businessType'],
  certificate: Pick<CertificateClass, 'ownerType' | 'usage'>,
): InstitutionType[] {
  return [...CERTIFICATE_INSTITUTIONS].filter((기관) => isCertificateUsableFor(기관, businessType, certificate))
}

/**
 * 저장한 상태와 만료일로 지금 상태를 파생합니다. 만료일 당일까지는 쓸 수 있습니다.
 *
 * 삭제된 인증서는 `UNREGISTERED`입니다. 그 인증서로 만든 연동이 이 상태를 봅니다.
 */
export function certificateStatus(
  certificate: { status: 'ACTIVE' | 'INACTIVE'; expiresOn: string; deleted: boolean },
  today: string,
): CertificateStatus {
  if (certificate.deleted) return 'UNREGISTERED'
  if (certificate.expiresOn < today) return 'EXPIRED'
  return certificate.status
}

/** 만료일까지 남은 날 수입니다. 오늘 만료면 0, 이미 지났으면 음수입니다. */
export function remainingDays(expiresOn: string, today: string): number {
  return Math.round((Date.parse(`${expiresOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
}
