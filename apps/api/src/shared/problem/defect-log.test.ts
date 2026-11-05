import { describe, expect, it } from 'vitest'
import { DecryptionFailed } from '../crypto/data-key.ts'
import { decodeRecord } from '../persistence/json-codec.ts'
import { describeDefect } from './defect-log.ts'

describe('describeDefect', () => {
  it('logs the error name and code location, not a message that may carry stored values', () => {
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

  it('keeps the message of a decryption failure, which names only the purpose and reason', () => {
    expect(describeDefect(new DecryptionFailed('hr/registrationNumber/aes-256-gcm', 'AUTHENTICATION'))).toBe(
      'DecryptionFailed: decryption failed (purpose=hr/registrationNumber/aes-256-gcm, reason=AUTHENTICATION); ' +
        'check that the data key matches the database',
    )
  })

  it('does not print values thrown as non-errors', () => {
    expect(describeDefect('owner@semu.example')).toBe('defect of type string')
    expect(describeDefect({ _tag: 'NoSuchElementError', value: 'owner@semu.example' })).toBe(
      'defect NoSuchElementError',
    )
  })
})
