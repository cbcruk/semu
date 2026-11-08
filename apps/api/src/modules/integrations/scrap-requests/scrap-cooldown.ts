import type { JobStatus } from '../../../shared/jobs/job.types.ts'
import type { InstitutionType } from '../institutions/institution.ts'

/** 사용자가 같은 기관을 다시 수동 수집하기까지 기다리는 초입니다. 기관마다 다르게 둘 수 있는 정책값입니다. */
export const SCRAP_COOLDOWN_SECONDS: Readonly<Record<InstitutionType, number>> = {
  HOMETAX: 600,
  CARD_SALES: 600,
  CREDIT_CARD: 600,
  BANK: 600,
  SPEED_BANK: 600,
  GIRO: 600,
  PG: 600,
  DELIVERY: 600,
  ALLRA: 600,
}

/** 끝나지 않은 수집 요청을 실패로 보는 초입니다. */
export const SCRAP_TIMEOUT_SECONDS = 600

/** 쿨다운 판정에 쓰는 마지막 수집 요청입니다. 시각은 epoch 밀리초입니다. */
export interface LatestScrapRequest {
  requester: 'USER' | 'SYSTEM'
  status: JobStatus
  timeoutAt: number
  /** 사용자 요청만 가집니다. 정기(시스템) 수집은 쿨다운을 만들지 않습니다. */
  nextAvailableAt?: number
}

/**
 * 지금 수동 수집을 받을 수 있는지입니다.
 *
 * - `RUNNING`: 앞 요청이 아직 진행 중(타임아웃 전)
 * - `COOLDOWN`: 사용자 요청 뒤 쿨다운 중
 */
export type ScrapAvailability =
  { canRequest: true } | { canRequest: false; reason: 'RUNNING' | 'COOLDOWN'; retryAfterSeconds: number }

function secondsUntil(target: number, now: number): number {
  return Math.max(0, Math.ceil((target - now) / 1000))
}

/** 대기(`QUEUED`)·진행(`RUNNING`) 중이라 아직 끝나지 않은 상태인지입니다. */
function 끝나지않은상태인가(status: JobStatus): boolean {
  return status === 'QUEUED' || status === 'RUNNING'
}

/**
 * 마지막 요청으로 수동 수집 가능 여부를 판정합니다.
 *
 * 진행 중인 요청은 타임아웃까지 막고, 남은 시간을 그대로 알려 줍니다(현행은 0초 또는 1초).
 * 타임아웃이 지난 요청은 진행 중이어도 막지 않습니다.
 */
export function scrapAvailability(latest: LatestScrapRequest | undefined, now: number): ScrapAvailability {
  if (latest === undefined) return { canRequest: true }
  if (끝나지않은상태인가(latest.status) && now < latest.timeoutAt) {
    return { canRequest: false, reason: 'RUNNING', retryAfterSeconds: Math.max(1, secondsUntil(latest.timeoutAt, now)) }
  }
  const 쿨다운남은초 =
    latest.requester === 'USER' && latest.nextAvailableAt !== undefined ? secondsUntil(latest.nextAvailableAt, now) : 0
  return 쿨다운남은초 > 0
    ? { canRequest: false, reason: 'COOLDOWN', retryAfterSeconds: 쿨다운남은초 }
    : { canRequest: true }
}

/** 저장된 상태에 타임아웃을 반영한 상태입니다. 끝나지 않은 채 타임아웃이 지나면 `FAILED`입니다. */
export function effectiveJobStatus(status: JobStatus, timeoutAt: number, now: number): JobStatus {
  return 끝나지않은상태인가(status) && now >= timeoutAt ? 'FAILED' : status
}

/**
 * 항목별 수집 결과를 요청 하나의 상태로 줄입니다. 일부만 실패하면 `PARTIALLY_SUCCEEDED`입니다.
 *
 * 현행은 일부 실패를 묶음 전체 `FAIL`로 보여 성공한 항목을 가렸습니다.
 */
export function summarizeItemResults(results: ReadonlyArray<'SUCCEEDED' | 'FAILED'>): JobStatus {
  const 실패항목수 = results.filter((result) => result === 'FAILED').length
  if (실패항목수 === 0) return 'SUCCEEDED'
  return 실패항목수 === results.length ? 'FAILED' : 'PARTIALLY_SUCCEEDED'
}

/** 여러 요청(전체 수집)의 상태를 하나로 줄입니다. 진행 중이 하나라도 있으면 `RUNNING`입니다. */
export function summarizeJobs(statuses: ReadonlyArray<JobStatus>): JobStatus {
  if (statuses.some(끝나지않은상태인가)) return 'RUNNING'
  if (statuses.every((status) => status === 'SUCCEEDED')) return 'SUCCEEDED'
  if (statuses.every((status) => status === 'FAILED' || status === 'CANCELED')) return 'FAILED'
  return 'PARTIALLY_SUCCEEDED'
}
