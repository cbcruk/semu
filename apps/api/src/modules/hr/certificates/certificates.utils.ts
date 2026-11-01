import { invalidField } from '../../../lib/domain-error'
import type { CertificateStatus } from './certificates.types'

const STATUSES: readonly CertificateStatus[] = ['issued', 'sending', 'sent', 'send_failed']

/**
 * Parses the comma-separated `status` query of the certificate list.
 *
 * @returns The statuses to keep, or an empty array for no status filter.
 */
export function parseCertificateStatuses(value: string | undefined): CertificateStatus[] {
  if (value === undefined || value.trim() === '') return []
  return value.split(',').map((part) => {
    const status = STATUSES.find((candidate) => candidate === part.trim())
    if (status === undefined) throw invalidField('status', `Unknown status: ${part.trim()}`)
    return status
  })
}
