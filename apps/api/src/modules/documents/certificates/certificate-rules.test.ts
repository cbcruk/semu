import { describe, expect, it } from 'vitest'
import { allowedCertificateActions, isCertificateLinkExpired } from './certificate-rules.ts'

describe('증명서 허용 액션(allowedCertificateActions)', () => {
  it('발송 중이거나 무효화한 뒤에는 할 수 있는 액션이 없습니다', () => {
    expect(allowedCertificateActions('SENDING')).toEqual([])
    expect(allowedCertificateActions('VOIDED')).toEqual([])
    expect(allowedCertificateActions('SENT')).toEqual(['SEND', 'VOID'])
  })
})

describe('증명서 링크 만료(isCertificateLinkExpired)', () => {
  it('만료 시각과 같은 시각부터 만료입니다', () => {
    expect(isCertificateLinkExpired('2026-07-01T00:00:00Z', '2026-06-30T23:59:59Z')).toBe(false)
    expect(isCertificateLinkExpired('2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z')).toBe(true)
    expect(isCertificateLinkExpired(undefined, '2026-07-01T00:00:00Z')).toBe(false)
  })
})
