import { describe, expect, it } from 'vitest'
import { memorySessionStore, sameSecret, SessionLocks } from './sessions.ts'
import type { BffSession } from './sessions.ts'

describe('SessionLocks', () => {
  it('rejects taking the same session lock inside itself instead of deadlocking', async () => {
    const locks = new SessionLocks()

    await expect(locks.exclusive('s', () => locks.shared('s', async () => 'inner'))).rejects.toThrow(/nesting/)
    await expect(locks.shared('s', () => locks.exclusive('s', async () => 'inner'))).rejects.toThrow(/nesting/)
    await expect(locks.exclusive('s', () => locks.shared('other', async () => 'ok'))).resolves.toBe('ok')
  })

  it('runs shared calls together and an exclusive one only after they finish', async () => {
    const locks = new SessionLocks()
    const events: string[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))

    const first = locks.shared('s', async () => {
      events.push('shared-1 start')
      await gate
      events.push('shared-1 end')
    })
    const second = locks.shared('s', async () => void events.push('shared-2'))
    const writer = locks.exclusive('s', async () => void events.push('exclusive'))
    await second
    release()
    await Promise.all([first, writer])

    expect(events).toEqual(['shared-1 start', 'shared-2', 'shared-1 end', 'exclusive'])
  })

  it('releases the lock when the task fails', async () => {
    const locks = new SessionLocks()

    await expect(locks.exclusive('s', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    await expect(locks.shared('s', async () => 'after')).resolves.toBe('after')
  })
})

describe('session store and secrets', () => {
  it('sweeps expired sessions', async () => {
    const store = memorySessionStore()
    const session = (id: string, expiresAt: number): BffSession => ({
      id,
      csrfToken: 'c',
      refreshCookie: 'r',
      plans: [],
      user: { id: 'usr_1', email: 'a@b.c', name: 'a', kind: 'CLIENT', isDemo: false },
      staySignedIn: false,
      expiresAt,
    })
    await store.save(session('old', 10))
    await store.save(session('new', 30))

    await store.sweep(20)

    expect(await store.get('old')).toBeUndefined()
    expect(await store.get('new')).toBeDefined()
  })

  it('compares secrets of different lengths without throwing', () => {
    expect(sameSecret('abc', 'abc')).toBe(true)
    expect(sameSecret('abc', 'abd')).toBe(false)
    expect(sameSecret('abc', 'abcd')).toBe(false)
  })
})
