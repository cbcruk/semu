import { describe, expect, it } from 'vitest'
import { allowedCertificateActions, isCertificateLinkExpired } from './certificate-rules.ts'

describe('allowedCertificateActions', () => {
  it('allows nothing while sending or after voiding', () => {
    expect(allowedCertificateActions('SENDING')).toEqual([])
    expect(allowedCertificateActions('VOIDED')).toEqual([])
    expect(allowedCertificateActions('SENT')).toEqual(['SEND', 'VOID'])
  })
})

describe('isCertificateLinkExpired', () => {
  it('expires at the expiry instant', () => {
    expect(isCertificateLinkExpired('2026-07-01T00:00:00Z', '2026-06-30T23:59:59Z')).toBe(false)
    expect(isCertificateLinkExpired('2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z')).toBe(true)
    expect(isCertificateLinkExpired(undefined, '2026-07-01T00:00:00Z')).toBe(false)
  })
})
