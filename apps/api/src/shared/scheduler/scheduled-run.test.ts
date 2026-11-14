import { describe, expect, it } from 'vitest'
import { decideClaim, finishRun } from './scheduled-run.ts'
import type { RetryPolicy, ScheduledRunRecord } from './scheduled-run.ts'

const POLICY: RetryPolicy = { maxAttempts: 2, baseDelayMs: 60_000, leaseMs: 600_000 }
const IDENTITY = { task: 'tax.filing-schedule', slot: '2026-11-14T03:00' }
const T0 = Date.parse('2026-11-13T18:00:00Z')

function started(now = T0): ScheduledRunRecord {
  const decision = decideClaim(undefined, IDENTITY, now, POLICY)
  if (decision.kind !== 'START') throw new Error('시작하지 못했습니다')
  return decision.record
}

describe('decideClaim', () => {
  it('기록이 없으면 첫 시도로 잡고 임대 시각을 둡니다', () => {
    expect(started()).toMatchObject({
      id: 'tax.filing-schedule@2026-11-14T03:00',
      status: 'RUNNING',
      attempts: 1,
      leaseUntil: new Date(T0 + 600_000).toISOString(),
    })
  })

  it('성공했거나 다른 실행기가 임대 중이면 건너뜁니다', () => {
    const succeeded = finishRun(started(), { ok: true, result: { created: 1 } }, T0 + 1000, POLICY)

    expect(decideClaim(succeeded, IDENTITY, T0 + 2000, POLICY)).toEqual({ kind: 'SKIP', reason: 'SUCCEEDED' })
    expect(decideClaim(started(), IDENTITY, T0 + 599_999, POLICY)).toEqual({ kind: 'SKIP', reason: 'RUNNING' })
  })

  it('실패하면 지연 뒤에 다시 잡고 시도를 다 쓰면 포기합니다', () => {
    const failed = finishRun(started(), { ok: false, error: 'CompaniesFailed' }, T0, POLICY)
    expect(failed).toMatchObject({ status: 'FAILED', nextAttemptAt: new Date(T0 + 60_000).toISOString() })
    expect(decideClaim(failed, IDENTITY, T0 + 59_999, POLICY)).toEqual({ kind: 'SKIP', reason: 'WAITING_RETRY' })

    const second = decideClaim(failed, IDENTITY, T0 + 60_000, POLICY)
    expect(second).toMatchObject({ kind: 'START', record: { attempts: 2, lastError: 'CompaniesFailed' } })
    if (second.kind !== 'START') return
    const finalFailure = finishRun(second.record, { ok: false, error: 'CompaniesFailed' }, T0 + 61_000, POLICY)
    expect(finalFailure.nextAttemptAt).toBeNull()
    expect(decideClaim(finalFailure, IDENTITY, T0 + 999_999, POLICY)).toEqual({ kind: 'SKIP', reason: 'GAVE_UP' })
  })

  it('임대 시각이 지난 실행은 죽은 것으로 보고 다시 잡거나, 시도를 다 썼으면 실패로 남깁니다', () => {
    const restarted = decideClaim(started(), IDENTITY, T0 + 600_000, POLICY)
    expect(restarted).toMatchObject({ kind: 'START', record: { attempts: 2 } })
    if (restarted.kind !== 'START') return

    expect(decideClaim(restarted.record, IDENTITY, T0 + 1_200_000, POLICY)).toMatchObject({
      kind: 'GIVE_UP',
      record: { status: 'FAILED', lastError: 'LEASE_EXPIRED', nextAttemptAt: null },
    })
  })
})
