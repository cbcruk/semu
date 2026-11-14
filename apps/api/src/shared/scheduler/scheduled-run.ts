/**
 * 정기 작업 실행 기록과, 슬롯 하나를 지금 돌릴지 정하는 순수 규칙입니다.
 */

/** 실행 상태입니다. `FAILED`는 다시 시도할 수 있으면 `nextAttemptAt`이 있습니다. */
export type ScheduledRunStatus = 'RUNNING' | 'SUCCEEDED' | 'FAILED'

/** 작업 하나의 슬롯 하나에 대한 실행 기록입니다. ID는 `<작업 이름>@<슬롯 키>`라 같은 슬롯의 기록은 하나입니다. */
export interface ScheduledRunRecord {
  readonly id: string
  readonly task: string
  readonly slot: string
  readonly status: ScheduledRunStatus
  /** 시작한 횟수입니다. 첫 시도가 1입니다. */
  readonly attempts: number
  readonly startedAt: string
  readonly finishedAt: string | null
  /** 이 시각까지 다른 실행기가 같은 슬롯을 잡지 않습니다. 실행 중 프로세스가 죽으면 이 시각 뒤에 다시 잡습니다. */
  readonly leaseUntil: string
  /** 실패한 슬롯을 다시 시도할 시각입니다. 다시 시도하지 않으면 `null`입니다. */
  readonly nextAttemptAt: string | null
  /** 마지막 실패의 요약입니다. 메시지에 저장 값이 섞이지 않도록 오류 이름·태그만 남깁니다. */
  readonly lastError: string | null
  /** 마지막 성공 결과(작업이 돌려준 요약)입니다. */
  readonly result: unknown
}

/** 재시도 규칙입니다. */
export interface RetryPolicy {
  /** 한 슬롯을 시작하는 최대 횟수입니다. */
  readonly maxAttempts: number
  /** 첫 재시도까지의 지연(ms)입니다. 그 뒤는 두 배씩 늘립니다. */
  readonly baseDelayMs: number
  /** 한 번 시작한 실행을 다른 실행기가 넘보지 않는 시간(ms)입니다. */
  readonly leaseMs: number
}

/** 기본 재시도 규칙입니다. 세 번(처음 + 5분 뒤 + 10분 뒤)까지 하고, 30분 동안 끝나지 않으면 죽은 실행으로 봅니다. */
export const DEFAULT_RETRY_POLICY: RetryPolicy = { maxAttempts: 3, baseDelayMs: 5 * 60 * 1000, leaseMs: 30 * 60 * 1000 }

/** 슬롯을 잡은 결과입니다. `START`면 `record`(시작 기록)를 저장하고 작업을 돌립니다. `SKIP`이면 아무것도 하지 않습니다. */
export type ClaimDecision =
  | { readonly kind: 'START'; readonly record: ScheduledRunRecord }
  | { readonly kind: 'SKIP'; readonly reason: 'SUCCEEDED' | 'RUNNING' | 'WAITING_RETRY' | 'GAVE_UP' }
  | { readonly kind: 'GIVE_UP'; readonly record: ScheduledRunRecord }

/**
 * 슬롯을 지금 시작할지 정합니다.
 *
 * - 기록이 없으면 첫 시도로 시작합니다
 * - 성공했으면 건너뜁니다
 * - 실행 중이고 임대 시각 전이면 건너뜁니다. 지났으면 실행기가 죽은 것으로 보고 실패 한 번으로 셉니다
 * - 실패했으면 `nextAttemptAt`이 지났을 때 다시 시작합니다. 시도 횟수를 다 쓰면 포기합니다(`GIVE_UP`은 죽은 실행을 실패로 남길 때)
 */
export function decideClaim(
  existing: ScheduledRunRecord | undefined,
  identity: { readonly task: string; readonly slot: string },
  now: number,
  policy: RetryPolicy,
): ClaimDecision {
  const at = new Date(now).toISOString()
  const start = (attempts: number): ClaimDecision => ({
    kind: 'START',
    record: {
      id: runIdOf(identity.task, identity.slot),
      task: identity.task,
      slot: identity.slot,
      status: 'RUNNING',
      attempts,
      startedAt: at,
      finishedAt: null,
      leaseUntil: new Date(now + policy.leaseMs).toISOString(),
      nextAttemptAt: null,
      lastError: existing?.lastError ?? null,
      result: null,
    },
  })
  if (existing === undefined) return start(1)
  switch (existing.status) {
    case 'SUCCEEDED':
      return { kind: 'SKIP', reason: 'SUCCEEDED' }
    case 'RUNNING': {
      if (Date.parse(existing.leaseUntil) > now) return { kind: 'SKIP', reason: 'RUNNING' }
      if (existing.attempts >= policy.maxAttempts) {
        return {
          kind: 'GIVE_UP',
          record: { ...existing, status: 'FAILED', finishedAt: at, nextAttemptAt: null, lastError: 'LEASE_EXPIRED' },
        }
      }
      return start(existing.attempts + 1)
    }
    case 'FAILED':
      if (existing.nextAttemptAt === null) return { kind: 'SKIP', reason: 'GAVE_UP' }
      if (Date.parse(existing.nextAttemptAt) > now) return { kind: 'SKIP', reason: 'WAITING_RETRY' }
      return start(existing.attempts + 1)
  }
}

/** 시작한 실행이 끝났을 때의 기록입니다. 실패면 시도가 남았을 때만 다음 시도 시각을 둡니다. */
export function finishRun(
  running: ScheduledRunRecord,
  outcome: { readonly ok: true; readonly result: unknown } | { readonly ok: false; readonly error: string },
  now: number,
  policy: RetryPolicy,
): ScheduledRunRecord {
  const at = new Date(now).toISOString()
  if (outcome.ok) {
    return { ...running, status: 'SUCCEEDED', finishedAt: at, nextAttemptAt: null, result: outcome.result }
  }
  const retry = running.attempts < policy.maxAttempts
  return {
    ...running,
    status: 'FAILED',
    finishedAt: at,
    lastError: outcome.error,
    nextAttemptAt: retry ? new Date(now + policy.baseDelayMs * 2 ** (running.attempts - 1)).toISOString() : null,
  }
}

/** 실행 기록의 ID입니다. */
export function runIdOf(task: string, slot: string): string {
  return `${task}@${slot}`
}
