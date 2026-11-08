import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { JobStatus } from '../../../shared/jobs/job.types.ts'
import { SCRAP_COOLDOWN_SECONDS, scrapAvailability, summarizeItemResults, summarizeJobs } from './scrap-cooldown.ts'
import type { LatestScrapRequest, ScrapAvailability } from './scrap-cooldown.ts'

/**
 * 현행 픽스처(`test/fixtures/rules/scrap-cooldown.json`)를 서버 쿨다운·작업 상태 규칙으로 옮긴 테스트입니다.
 *
 * 현행 `request|done|timeout`은 `Job` 상태로, `canScrapping`·`remainSeconds`는 {@link ScrapAvailability}로,
 * 폴링 `PROGRESS|SUCCESS|FAIL`은 `RUNNING|SUCCEEDED|PARTIALLY_SUCCEEDED|FAILED`로 바꿉니다.
 */

interface FixtureCase {
  name: string
  input: Record<string, any>
  expected: any
}

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../../../test/fixtures/rules/scrap-cooldown.json'), 'utf8'),
) as { cases: FixtureCase[] }

function latestOf(raw: any): LatestScrapRequest | undefined {
  if (raw === null) return undefined
  const status: JobStatus = raw.status === 'request' ? 'RUNNING' : raw.status === 'timeout' ? 'FAILED' : 'SUCCEEDED'
  return {
    requester: raw.requester === 'user' ? 'USER' : 'SYSTEM',
    status,
    timeoutAt: Date.parse(raw.timeoutAt),
    ...(raw.nextAvailableAt === null ? {} : { nextAvailableAt: Date.parse(raw.nextAvailableAt) }),
  }
}

/** 현행 기대값을 서버 판정으로 바꿉니다. 진행 중인 요청은 남은 시간을 알려 줍니다(결정 3). */
const CHANGED: Record<string, ScrapAvailability> = {
  'system request still running blocks the button but reports 0 seconds': {
    canRequest: false,
    reason: 'RUNNING',
    retryAfterSeconds: 540,
  },
  'manual request while a system request runs is refused with remain at least 1': {
    canRequest: false,
    reason: 'RUNNING',
    retryAfterSeconds: 540,
  },
}

function legacyAvailability(expected: any): ScrapAvailability {
  if (expected.accepted === true || expected.canScrapping === true) return { canRequest: true }
  const remain = expected.remain_seconds ?? expected.remainSeconds
  return { canRequest: false, reason: 'COOLDOWN', retryAfterSeconds: remain }
}

/** 서버 테스트로 옮기지 않은 케이스와 그 이유입니다. */
const NOT_PORTED: Record<string, string> = {
  'manual request without any connected integration is a validation error':
    'scrap-requests.http.test.ts가 422 INSTITUTION_NOT_CONNECTED로 검사합니다',
  'polling: unknown id is 404': 'scrap-requests.http.test.ts가 GET /scrap-requests/{id}의 404로 검사합니다',
}

const availabilityCases = fixture.cases.filter(
  (testCase) =>
    (testCase.input['check'] === 'lastStatus' || testCase.input['check'] === 'request') &&
    !(testCase.name in NOT_PORTED),
)

const pollingCases = fixture.cases.filter(
  (testCase) => testCase.input['check'] === 'polling' && !(testCase.name in NOT_PORTED),
)

/** 요청 묶음을 작업 상태 하나로 줄입니다. 진행 중이 있으면 `RUNNING`, 아니면 항목 결과와 타임아웃을 합칩니다. */
function pollingStatus(requests: string[], results: string[]): JobStatus {
  if (requests.includes('request')) return summarizeJobs(['RUNNING'])
  const items = [
    ...results.map((result) => (result === 'success' ? ('SUCCEEDED' as const) : ('FAILED' as const))),
    ...requests.filter((request) => request === 'timeout').map(() => 'FAILED' as const),
  ]
  return summarizeItemResults(items)
}

const POLLING: Record<string, JobStatus> = {
  PROGRESS: 'RUNNING',
  SUCCESS: 'SUCCEEDED',
}

/** 일부 실패는 묶음 전체 실패가 아니라 부분 성공입니다(결정 4). */
const POLLING_CHANGED: Record<string, JobStatus> = {
  'polling: one failed item makes the whole group FAIL': 'PARTIALLY_SUCCEEDED',
  'polling: a timed out request is FAIL': 'PARTIALLY_SUCCEEDED',
}

describe('수동 수집 쿨다운 규칙 픽스처', () => {
  it.each(availabilityCases.map((testCase) => [testCase.name, testCase] as const))('%s', (_, testCase) => {
    const availability = scrapAvailability(latestOf(testCase.input['latest']), Date.parse(testCase.input['now']))

    expect(availability).toEqual(CHANGED[testCase.name] ?? legacyAvailability(testCase.expected))
  })

  it('쿨다운이 끝난 뒤 요청하면 새로 600초 쿨다운을 시작합니다', () => {
    const testCase = fixture.cases.find((candidate) => candidate.name.startsWith('manual request after cooldown'))!
    const now = Date.parse(testCase.input['now'])

    expect(new Date(now + SCRAP_COOLDOWN_SECONDS.BANK * 1000).getTime()).toBe(
      Date.parse(testCase.expected.nextAvailableAt),
    )
  })

  it('전체 수집은 쿨다운 중이거나 연동되지 않은 서비스를 건너뜁니다', () => {
    const testCase = fixture.cases.find((candidate) => candidate.input['check'] === 'requestAll')!
    const now = Date.parse(testCase.input['now'])
    const services = testCase.input['services'] as Record<string, { connected: boolean; latest: unknown }>
    const queued = Object.entries(services)
      .filter(([, service]) => service.connected && scrapAvailability(latestOf(service.latest), now).canRequest)
      .map(([name]) => name)

    expect(queued).toEqual(testCase.expected.queued)
  })

  it.each(pollingCases.map((testCase) => [testCase.name, testCase] as const))('%s', (_, testCase) => {
    const status = pollingStatus(testCase.input['requests'], testCase.input['results'])

    expect(status).toBe(POLLING_CHANGED[testCase.name] ?? POLLING[testCase.expected])
  })

  it('옮기지 않은 케이스는 모두 이유를 적습니다', () => {
    const ported = new Set([
      ...availabilityCases.map((testCase) => testCase.name),
      ...pollingCases.map((testCase) => testCase.name),
      ...fixture.cases.filter((testCase) => testCase.input['check'] === 'requestAll').map((testCase) => testCase.name),
    ])
    const rest = fixture.cases.map((testCase) => testCase.name).filter((name) => !ported.has(name))

    expect(rest.sort()).toEqual(Object.keys(NOT_PORTED).sort())
  })
})
