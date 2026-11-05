import { describe, expect, it } from 'vitest'
import { allowedEsignActions, dueDateOnSend, isLinkClosed, isOverdue } from './esign-request-status.ts'

describe('allowedEsignActions', () => {
  it('lets a draft be edited, deleted and sent', () => {
    expect(allowedEsignActions('DRAFT')).toEqual(['UPDATE', 'DELETE', 'SEND'])
  })

  it('adds download to a completed request', () => {
    expect(allowedEsignActions('COMPLETED')).toEqual(['VOID', 'DOWNLOAD'])
  })

  it('lets a closed request be resent, reverted or deleted', () => {
    expect(allowedEsignActions('CANCELED')).toEqual(['DELETE', 'RESEND', 'REVERT_TO_DRAFT'])
  })
})

describe('signer link', () => {
  it('stays open for download after completion', () => {
    expect(isLinkClosed('COMPLETED')).toBe(false)
    expect(isLinkClosed('CANCELED')).toBe(true)
  })
})

describe('due date', () => {
  it('defaults to 16 days after sending', () => {
    expect(dueDateOnSend(undefined, '2026-06-23')).toBe('2026-07-09')
  })

  it('expires the day after the due date', () => {
    expect(isOverdue('PENDING', '2026-07-09', '2026-07-09')).toBe(false)
    expect(isOverdue('PENDING', '2026-07-09', '2026-07-10')).toBe(true)
    expect(isOverdue('COMPLETED', '2026-07-09', '2026-07-10')).toBe(false)
  })
})
