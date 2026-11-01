import type { IntegrationType } from '../adapters/scraping.adapter'
import type { CertificateRow, CertificateStatus, CertUsage } from './integrations.types'

/** How the server classifies a certificate policy OID. */
export interface OidClass {
  certType: 'personal' | 'business'
  usage: CertUsage
  organizationCode: string
}

/**
 * Certificate policy OIDs of the accredited issuers, a subset of the client's table (B:89563).
 *
 * Unknown OIDs are rejected at registration; extend this table from the
 * bundle before production.
 */
export const CERT_OIDS: Readonly<Record<string, OidClass>> = {
  '1.2.410.200005.1.1.1': { certType: 'personal', usage: 'general', organizationCode: 'yessign' },
  '1.2.410.200005.1.1.4': { certType: 'personal', usage: 'bank', organizationCode: 'yessign' },
  '1.2.410.200005.1.1.5': { certType: 'business', usage: 'general', organizationCode: 'yessign' },
  '1.2.410.200005.1.1.2': { certType: 'business', usage: 'bank', organizationCode: 'yessign' },
  '1.2.410.200005.1.1.6.2': { certType: 'business', usage: 'etax', organizationCode: 'yessign' },
  '1.2.410.200004.5.1.1.5': { certType: 'personal', usage: 'general', organizationCode: 'signkorea' },
  '1.2.410.200004.5.1.1.7': { certType: 'business', usage: 'general', organizationCode: 'signkorea' },
  '1.2.410.200004.5.2.1.2': { certType: 'personal', usage: 'general', organizationCode: 'signgate' },
  '1.2.410.200004.5.2.1.1': { certType: 'business', usage: 'general', organizationCode: 'signgate' },
  '1.2.410.200004.5.4.1.1': { certType: 'personal', usage: 'general', organizationCode: 'crosscert' },
  '1.2.410.200004.5.4.1.2': { certType: 'business', usage: 'general', organizationCode: 'crosscert' },
}

const ORGANIZATION_NAMES: Readonly<Record<string, string>> = {
  yessign: '금융결제원',
  signkorea: '코스콤',
  signgate: '한국정보인증',
  crosscert: '한국전자인증',
  KICA: '한국정보인증',
  tradesign: '한국무역정보통신',
}

const USAGE_LABELS: Readonly<Record<CertUsage, string>> = { general: '범용', bank: '은행/카드/보험용', etax: '전자세금용' }

/** Integration types that can authenticate with a certificate. */
export const CERT_SERVICES: readonly IntegrationType[] = ['hometax', 'giro', 'bank', 'creditcard']

/** Derives the client-facing certificate status; `EXPIRED` once the end date has passed. */
export function certificateStatus(cert: CertificateRow | undefined, today: string): CertificateStatus {
  if (cert === undefined || cert.deleted_at !== null) return 'UNREGISTERED'
  if (cert.end_date < today) return 'EXPIRED'
  return cert.status
}

/**
 * Checks the issuer rules of the institution screens (M:08-설정/15).
 *
 * Hometax takes business general or e-tax certificates. Giro, banks and card
 * companies take bank or general certificates in the corporation's name for
 * corporations, and in the representative's name for sole proprietors.
 */
export function isCertAllowedFor(cert: Pick<CertificateRow, 'cert_type' | 'usage'>, service: IntegrationType, businessType: 'corporate' | 'individual'): boolean {
  if (service === 'hometax') return cert.cert_type === 'business' && (cert.usage === 'general' || cert.usage === 'etax')
  if (service === 'giro' || service === 'bank' || service === 'creditcard') {
    const owner = businessType === 'corporate' ? 'business' : 'personal'
    return cert.cert_type === owner && (cert.usage === 'bank' || cert.usage === 'general')
  }
  return false
}

/** Serializes a certificate as the legacy `Cert` object plus classification and status. */
export function serializeCertificate(cert: CertificateRow, today: string, linkedServices?: readonly IntegrationType[]): Record<string, unknown> {
  const status = certificateStatus(cert, today)
  const typeLabel = `${cert.cert_type === 'personal' ? '개인' : '사업자'}(${USAGE_LABELS[cert.usage]})`
  return {
    id: cert.id,
    oid: cert.oid,
    is_active: status === 'ACTIVE',
    cert_name: cert.cert_name,
    org_name: ORGANIZATION_NAMES[cert.organization_code] ?? cert.organization_code,
    organization_code: cert.organization_code,
    pub_date: cert.pub_date,
    end_date: cert.end_date,
    cert_type: cert.cert_type,
    usage: cert.usage,
    type_label: typeLabel,
    owner_name: cert.owner_name,
    status,
    remaining_days: Math.round((Date.parse(cert.end_date) - Date.parse(today)) / 86_400_000),
    ...(linkedServices === undefined ? {} : { linked_services: linkedServices }),
  }
}
