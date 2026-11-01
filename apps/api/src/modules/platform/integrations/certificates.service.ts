import type { ServiceDeps } from '../../../app.types'
import { DomainError, invalidField, notFound } from '../../../lib/domain-error'
import { isPlainDate } from '../../../lib/plain-date'
import type { CompanyRow } from '../../companies/companies.types'
import type { CertificateMaterial } from '../adapters/scraping.adapter'
import { listRepresentatives } from '../company-profile/company-profile.repository'
import type { PlatformDeps } from '../platform.types'
import { newId } from '../platform.utils'
import { CERT_OIDS, certificateStatus, serializeCertificate } from './certificates.utils'
import { deleteCertificate, findCertificate, findCertificateBySerial, insertCertificate, listCertificates, listIntegrations } from './integrations.repository'
import type { CertificateRow } from './integrations.types'

/** Fields the local certificate agent (ExAdapter) extracts and uploads; blobs arrive already encrypted by the agent. */
export interface CertificateUpload {
  cert_der_b64: string
  key_enc_b64: string
  sign_pw: string
  subject_dn: string
  oid: string
  serial: string
  pub_date: string
  end_date: string
  owner_name: string
  owner_business_number?: string | undefined
  cert_name?: string | undefined
}

/** Lists a company's certificates; with `detail`, also the integration types using each one. */
export function listCompanyCertificates(deps: ServiceDeps, companyId: string, detail: boolean): Record<string, unknown>[] {
  const today = deps.clock.today()
  const integrations = detail ? listIntegrations(deps.db, companyId) : []
  return listCertificates(deps.db, companyId).map((cert) => {
    const linked = detail ? [...new Set(integrations.filter((row) => row.certificate_id === cert.id).map((row) => row.type))] : undefined
    return serializeCertificate(cert, today, linked)
  })
}

/**
 * Registers a certificate uploaded by the local agent.
 *
 * The OID decides the type and usage. Business certificates must carry the
 * company's business number; personal certificates must belong to a
 * registered representative, and corporations accept business certificates
 * only. Key material and the signing password are encrypted at rest.
 *
 * @throws {DomainError} `VALIDATION_FAILED` for unknown OIDs, expired or
 * foreign certificates and wrong passwords, or `CONFLICT` for duplicates.
 */
export async function registerCertificate(deps: PlatformDeps, company: CompanyRow, userId: string, upload: CertificateUpload): Promise<Record<string, unknown>> {
  const today = deps.clock.today()
  const oidClass = CERT_OIDS[upload.oid]
  if (oidClass === undefined) throw invalidField('oid', 'This certificate type is not supported.')
  if (!isPlainDate(upload.end_date) || !isPlainDate(upload.pub_date)) throw invalidField('end_date', 'Expected YYYY-MM-DD dates.')
  if (upload.end_date < today) throw invalidField('end_date', 'The certificate has expired.')
  assertOwner(deps, company, oidClass.certType, upload)
  if (findCertificateBySerial(deps.db, company.id, upload.serial) !== undefined) throw new DomainError('CONFLICT', 'This certificate is already registered.')
  const material: CertificateMaterial = { certBlob: upload.cert_der_b64, keyBlob: upload.key_enc_b64, signPw: upload.sign_pw }
  if (!(await deps.scraping.checkCertificatePassword(material))) throw invalidField('sign_pw', 'The certificate password is incorrect.')
  const now = deps.clock.now()
  const row: CertificateRow = {
    id: newId('cert'),
    company_id: company.id,
    cert_name: upload.cert_name ?? upload.owner_name,
    subject_dn: upload.subject_dn,
    oid: upload.oid,
    cert_type: oidClass.certType,
    usage: oidClass.usage,
    organization_code: oidClass.organizationCode,
    serial: upload.serial,
    pub_date: upload.pub_date,
    end_date: upload.end_date,
    owner_name: upload.owner_name,
    owner_business_number: upload.owner_business_number?.replace(/-/g, '') ?? null,
    status: 'ACTIVE',
    cert_blob_enc: deps.cipher.encrypt(upload.cert_der_b64),
    key_blob_enc: deps.cipher.encrypt(upload.key_enc_b64),
    sign_pw_enc: deps.cipher.encrypt(upload.sign_pw),
    registered_by: userId,
    created_at: now,
    modified_at: now,
    deleted_at: null,
  }
  insertCertificate(deps.db, row)
  return serializeCertificate(row, today, [])
}

/** Deletes a certificate; integrations that used it report `UNREGISTERED` from then on. */
export function removeCertificate(deps: ServiceDeps, companyId: string, certificateId: string): void {
  const cert = requireLiveCertificate(deps, companyId, certificateId)
  deleteCertificate(deps.db, cert.id, deps.clock.now())
}

/**
 * Checks a signing password against the stored one and the private key.
 *
 * @throws {DomainError} `VALIDATION_FAILED` on `sign_pw` when it does not match.
 */
export async function checkCertificatePassword(deps: PlatformDeps, companyId: string, certificateId: string, signPw: string): Promise<void> {
  const cert = requireLiveCertificate(deps, companyId, certificateId)
  const material = certificateMaterial(deps, cert)
  const valid = material.signPw === signPw && (await deps.scraping.checkCertificatePassword({ ...material, signPw }))
  if (!valid) throw invalidField('sign_pw', 'The certificate password is incorrect.')
}

/**
 * Signs the company up to Internet Giro with a certificate.
 *
 * The Giro ID and password go straight to the adapter and are never stored.
 *
 * @throws {DomainError} `VALIDATION_FAILED` when a required Giro term is not agreed or Giro rejects the sign-up.
 */
export async function joinGiro(
  deps: PlatformDeps,
  companyId: string,
  certificateId: string,
  input: { giro_id: string; giro_pw: string; email: string; phone: string; agreements: Record<string, boolean> },
): Promise<void> {
  const required = ['terms_of_use', 'privacy_policy', 'credit_info_collection', 'third_party_provision', 'unique_id_collection', 'cert_identity_service']
  const missing = required.filter((code) => input.agreements[code] !== true)
  if (missing.length > 0) throw invalidField('agreements', `Agree to every Internet Giro term: ${missing.join(', ')}.`)
  const cert = requireLiveCertificate(deps, companyId, certificateId)
  const outcome = await deps.scraping.joinGiro({ certificate: certificateMaterial(deps, cert), giroId: input.giro_id, giroPw: input.giro_pw, email: input.email, phone: input.phone })
  if (!outcome.ok) throw invalidField('giro_id', outcome.message)
}

/** Decrypts a certificate's key material for the scraping worker. */
export function certificateMaterial(deps: ServiceDeps, cert: CertificateRow): CertificateMaterial {
  return { certBlob: deps.cipher.decrypt(cert.cert_blob_enc), keyBlob: deps.cipher.decrypt(cert.key_blob_enc), signPw: deps.cipher.decrypt(cert.sign_pw_enc) }
}

/**
 * Loads a certificate that has not been deleted.
 *
 * @throws {DomainError} `NOT_FOUND`.
 */
export function requireLiveCertificate(deps: ServiceDeps, companyId: string, certificateId: string): CertificateRow {
  const cert = findCertificate(deps.db, companyId, certificateId)
  if (cert === undefined || cert.deleted_at !== null) throw notFound('Certificate')
  return cert
}

/** Returns the status of an integration's certificate, or `null` when it uses none. */
export function certificateStatusOf(deps: ServiceDeps, companyId: string, certificateId: string | null): ReturnType<typeof certificateStatus> | null {
  if (certificateId === null) return null
  return certificateStatus(findCertificate(deps.db, companyId, certificateId), deps.clock.today())
}

function assertOwner(deps: ServiceDeps, company: CompanyRow, certType: 'personal' | 'business', upload: CertificateUpload): void {
  if (certType === 'business') {
    if (upload.owner_business_number?.replace(/-/g, '') !== company.business_number.replace(/-/g, '')) {
      throw invalidField('owner_business_number', "The certificate is not in the company's name.")
    }
    return
  }
  if (company.business_type === 'corporate') throw invalidField('oid', 'Corporations must register a certificate in the corporation\'s name.')
  const names = listRepresentatives(deps.db, company.id).map((row) => row.name)
  if (!names.includes(upload.owner_name)) throw invalidField('owner_name', "The certificate is not in the representative's name.")
}
