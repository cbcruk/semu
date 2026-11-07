import { describe, expect, it } from 'vitest'
import { allowedEsignActions, dueDateOnSend, isLinkClosed, isOverdue } from './esign-request-status.ts'

describe('관리자 화면의 허용 액션(allowedEsignActions)', () => {
  it('초안은 수정·삭제·발송할 수 있습니다', () => {
    expect(allowedEsignActions('DRAFT')).toEqual(['UPDATE', 'DELETE', 'SEND'])
  })

  it('완료된 요청에는 다운로드를 더합니다', () => {
    expect(allowedEsignActions('COMPLETED')).toEqual(['VOID', 'DOWNLOAD'])
  })

  it('취소된 요청은 재발송하거나 초안으로 되돌리거나 지울 수 있습니다', () => {
    expect(allowedEsignActions('CANCELED')).toEqual(['DELETE', 'RESEND', 'REVERT_TO_DRAFT'])
  })
})

describe('서명 링크', () => {
  it('완료 뒤에도 다운로드를 위해 열려 있습니다', () => {
    expect(isLinkClosed('COMPLETED')).toBe(false)
    expect(isLinkClosed('CANCELED')).toBe(true)
  })
})

describe('서명 기한', () => {
  it('지정하지 않으면 발송일로부터 16일 뒤입니다', () => {
    expect(dueDateOnSend(undefined, '2026-06-23')).toBe('2026-07-09')
  })

  it('기한 당일까지 유효하고 다음날부터 만료입니다', () => {
    expect(isOverdue('PENDING', '2026-07-09', '2026-07-09')).toBe(false)
    expect(isOverdue('PENDING', '2026-07-09', '2026-07-10')).toBe(true)
    expect(isOverdue('COMPLETED', '2026-07-09', '2026-07-10')).toBe(false)
  })
})
