import { describe, expect, it } from 'vitest'
import { effectiveJobStatus, scrapAvailability, summarizeItemResults, summarizeJobs } from './scrap-cooldown.ts'

describe('수동 수집 가능 여부', () => {
  it('요청이 진행 중이면 타임아웃까지 남은 시간을 알려 줍니다', () => {
    expect(scrapAvailability({ requester: 'USER', status: 'QUEUED', timeoutAt: 600_000 }, 59_000)).toEqual({
      canRequest: false,
      reason: 'RUNNING',
      retryAfterSeconds: 541,
    })
  })
})

describe('타임아웃을 반영한 수집 상태', () => {
  it('끝나지 않은 요청이 타임아웃을 지나면 FAILED로 봅니다', () => {
    expect(effectiveJobStatus('RUNNING', 1_000, 999)).toBe('RUNNING')
    expect(effectiveJobStatus('RUNNING', 1_000, 1_000)).toBe('FAILED')
    expect(effectiveJobStatus('SUCCEEDED', 1_000, 5_000)).toBe('SUCCEEDED')
  })
})

describe('수집 결과 요약', () => {
  it('일부만 실패하면 성공한 항목을 가리지 않습니다', () => {
    expect(summarizeItemResults(['SUCCEEDED', 'FAILED'])).toBe('PARTIALLY_SUCCEEDED')
    expect(summarizeItemResults(['FAILED'])).toBe('FAILED')
    expect(summarizeItemResults([])).toBe('SUCCEEDED')
  })

  it('전체 수집 묶음의 상태를 하나로 줄입니다', () => {
    expect(summarizeJobs(['SUCCEEDED', 'QUEUED'])).toBe('RUNNING')
    expect(summarizeJobs(['FAILED', 'CANCELED'])).toBe('FAILED')
    expect(summarizeJobs(['SUCCEEDED', 'PARTIALLY_SUCCEEDED'])).toBe('PARTIALLY_SUCCEEDED')
  })
})
