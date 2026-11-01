import { describe, expect, it } from 'vitest'
import { runPeriodicJobs } from '../src/jobs/run-periodic-jobs'
import { createTestContext, JWT_SECRET, TAX_TERMS_VERSION } from './helpers/test-app'

describe('runPeriodicJobs', () => {
  it('runs every recurring job and settles into a no-op on the second run', async () => {
    const ctx = await createTestContext()
    const deps = { ...ctx, jwtSecret: JWT_SECRET, taxTermsVersion: TAX_TERMS_VERSION, maxUploadBytes: 1024 }
    await runPeriodicJobs(deps)
    const second = await runPeriodicJobs(deps)
    expect(second.filings).toEqual({ created: 0, updated: 0, cancelled: 0 })
    expect(second.scraping).toEqual({ done: 0, timedOut: 0 })
    expect(second.billedPayments).toBe(0)
    expect(second.sweptFiles).toBe(0)
  })
})
