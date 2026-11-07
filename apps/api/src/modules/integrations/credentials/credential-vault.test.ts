import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { openSecret, sealSecret } from './credential-vault.ts'

describe('자격 증명 금고', () => {
  const key = randomBytes(32)

  it('필드를 읽을 수 없게 암호화했다가 그대로 되살립니다', () => {
    const sealed = sealSecret(key, { password: 'hometax-1234' })

    expect(JSON.stringify(sealed)).not.toContain('hometax-1234')
    expect(openSecret(key, sealed)).toEqual({ password: 'hometax-1234' })
  })

  it('변조된 값이나 다른 키로는 풀지 않습니다', () => {
    const sealed = sealSecret(key, { password: 'x' })
    const tampered = { ...sealed, ciphertext: Buffer.from('tampered').toString('base64') }

    expect(() => openSecret(key, tampered)).toThrow()
    expect(() => openSecret(randomBytes(32), sealed)).toThrow()
  })
})
