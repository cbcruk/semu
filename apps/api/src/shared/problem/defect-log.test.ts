import { describe, expect, it } from 'vitest'
import { DecryptionFailed } from '../crypto/data-key.ts'
import { decodeRecord } from '../persistence/json-codec.ts'
import { describeDefect } from './defect-log.ts'

describe('결함 요약', () => {
  it('저장된 값이 담길 수 있는 메시지 대신 오류 이름과 코드 위치를 남깁니다', () => {
    let defect: unknown
    try {
      decodeRecord('{"name":"홍길동","email":"leak@example.com"')
    } catch (error) {
      defect = error
    }

    const logged = describeDefect(defect)

    expect(logged).toMatch(/^SyntaxError at src\/shared\/persistence\/json-codec\.ts:\d+$/)
    expect(logged).not.toContain('leak@example.com')
    expect(logged).not.toContain('홍길동')
  })

  it('복호화 실패는 용도와 사유만 담으므로 메시지를 그대로 남깁니다', () => {
    expect(describeDefect(new DecryptionFailed('hr/registrationNumber/aes-256-gcm', 'AUTHENTICATION'))).toBe(
      'DecryptionFailed: decryption failed (purpose=hr/registrationNumber/aes-256-gcm, reason=AUTHENTICATION); ' +
        'check that the data key matches the database',
    )
  })

  it('여러 줄 메시지를 스택 프레임으로 읽지 않습니다', () => {
    const defect = new Error('x\nuser leak@example.com:12:34')
    defect.stack =
      'Error: x\nuser leak@example.com:12:34\n' +
      '    at run (file:///app/node_modules/effect/dist/esm/internal/fiber.js:10:5)\n' +
      '    at node:internal/process/task_queues:105:5'

    expect(describeDefect(defect)).toBe('Error at node_modules/effect/dist/esm/internal/fiber.js:10')

    defect.stack = 'Error: x\nuser leak@example.com:12:34'
    expect(describeDefect(defect)).toBe('Error')
  })

  it('Error가 아닌 값을 던지면 그 값을 출력하지 않습니다', () => {
    expect(describeDefect('owner@semu.example')).toBe('defect of type string')
    expect(describeDefect({ _tag: 'NoSuchElementError', value: 'owner@semu.example' })).toBe(
      'defect NoSuchElementError',
    )
  })
})
