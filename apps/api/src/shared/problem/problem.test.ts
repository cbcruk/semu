import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { NotFound, problemType } from './problem.ts'

describe('문제 유형', () => {
  it('오류 코드를 semu 문제 URN으로 바꿉니다', () => {
    expect(problemType('APPOINTMENT_SLOT_FULL')).toBe('urn:semu:problem:appointment-slot-full')
  })
})

describe('찾을 수 없음 문제', () => {
  it('RFC 9457 필드로 인코딩하고 비어 있는 선택 필드는 뺍니다', () => {
    expect(Schema.encodeSync(NotFound)(new NotFound({}))).toEqual({
      type: 'urn:semu:problem:not-found',
      title: 'Resource not found',
      status: 404,
      code: 'NOT_FOUND',
    })
  })
})
