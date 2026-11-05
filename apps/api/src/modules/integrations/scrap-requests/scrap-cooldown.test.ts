import { describe, expect, it } from 'vitest'
import { effectiveJobStatus, scrapAvailability, summarizeItemResults, summarizeJobs } from './scrap-cooldown.ts'

describe('scrapAvailability', () => {
  it('reports the time left until the timeout while a request runs', () => {
    expect(scrapAvailability({ requester: 'USER', status: 'QUEUED', timeoutAt: 600_000 }, 59_000)).toEqual({
      canRequest: false,
      reason: 'RUNNING',
      retryAfterSeconds: 541,
    })
  })
})

describe('effectiveJobStatus', () => {
  it('turns an unfinished request past its timeout into FAILED', () => {
    expect(effectiveJobStatus('RUNNING', 1_000, 999)).toBe('RUNNING')
    expect(effectiveJobStatus('RUNNING', 1_000, 1_000)).toBe('FAILED')
    expect(effectiveJobStatus('SUCCEEDED', 1_000, 5_000)).toBe('SUCCEEDED')
  })
})

describe('summaries', () => {
  it('keeps successful items visible when only some fail', () => {
    expect(summarizeItemResults(['SUCCEEDED', 'FAILED'])).toBe('PARTIALLY_SUCCEEDED')
    expect(summarizeItemResults(['FAILED'])).toBe('FAILED')
    expect(summarizeItemResults([])).toBe('SUCCEEDED')
  })

  it('reduces a request-all group to one status', () => {
    expect(summarizeJobs(['SUCCEEDED', 'QUEUED'])).toBe('RUNNING')
    expect(summarizeJobs(['FAILED', 'CANCELED'])).toBe('FAILED')
    expect(summarizeJobs(['SUCCEEDED', 'PARTIALLY_SUCCEEDED'])).toBe('PARTIALLY_SUCCEEDED')
  })
})
