import { describe, expect, it } from 'vitest'
import { IdempotencyKeys } from './idempotency.ts'

describe('IdempotencyKeys', () => {
  it('runs the same fingerprint one at a time with one key, even after a failure', async () => {
    const keys = new IdempotencyKeys(1_000, () => 0)
    const order: string[] = []
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))

    const first = keys.run('fp', 'p', async (key) => {
      order.push(`start ${key}`)
      await gate
      order.push('end first')
      throw new Error('upstream failed')
    })
    const second = keys.run('fp', 'p', async (key) => {
      order.push(`start ${key}`)
      return key
    })
    await Promise.resolve()
    release()

    await expect(first).rejects.toThrow('upstream failed')
    const key = await second
    expect(key).toMatch(/^p:/)
    expect(order).toEqual([`start ${key}`, 'end first', `start ${key}`])
  })

  it('keeps the key for the window after the last request ends, per fingerprint', async () => {
    let now = 0
    const keys = new IdempotencyKeys(1_000, () => now)
    const keyOf = (fingerprint: string) => keys.run(fingerprint, 'p', async (key) => key)

    const first = await keyOf('fp')
    now = 999
    const within = await keyOf('fp')
    const other = await keyOf('other')
    now = 999 + 1_000
    const after = await keyOf('fp')

    expect(within).toBe(first)
    expect(other).not.toBe(first)
    expect(after).not.toBe(first)
  })

  it('fingerprints the parts in order without keeping them', () => {
    const fingerprint = IdempotencyKeys.fingerprint(['session', 'cmp_1', 'pyl_1', 'psl_1'])

    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(fingerprint).toBe(IdempotencyKeys.fingerprint(['session', 'cmp_1', 'pyl_1', 'psl_1']))
    expect(fingerprint).not.toBe(IdempotencyKeys.fingerprint(['session', 'cmp_1', 'pyl_1psl_1']))
  })
})
