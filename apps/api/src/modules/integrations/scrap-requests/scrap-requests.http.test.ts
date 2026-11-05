import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEMO_COMPANY_IDS } from '../../identity-access/identity-access.public.ts'
import { makeTestApp } from '../../identity-access/testing-http.ts'
import type { TestApp } from '../../identity-access/testing-http.ts'

let app: TestApp
let token: string

beforeEach(async () => {
  app = makeTestApp()
  token = (await app.signIn('owner@alfred.example')).token
})

afterEach(() => app.dispose())

const key = (value: string) => ({ 'idempotency-key': value })

describe('POST /v1/scrap-requests', () => {
  it('accepts a manual collection, runs it and then holds the next one for the cooldown', async () => {
    const accepted = await app.request('POST', '/v1/scrap-requests', {
      token,
      headers: key('k-1'),
      body: { institutionType: 'BANK' },
    })
    const job = await accepted.json()
    const done = await (await app.request('GET', `/v1/scrap-requests/${job.id}`, { token })).json()
    const tooSoon = await app.request('POST', '/v1/scrap-requests', {
      token,
      headers: key('k-2'),
      body: { institutionType: 'BANK' },
    })

    expect(accepted.status).toBe(202)
    expect(job).toMatchObject({ institutionType: 'BANK', requester: 'USER', status: 'QUEUED', isInitial: true })
    expect(done).toMatchObject({ status: 'SUCCEEDED', result: { items: [{ itemKey: '004-1' }, { itemKey: '004-2' }] } })
    expect(tooSoon.status).toBe(429)
    const problem = await tooSoon.json()
    expect(problem).toMatchObject({ code: 'SCRAP_REQUEST_TOO_SOON', reason: 'COOLDOWN' })
    expect(problem.retryAfterSeconds).toBeGreaterThan(590)
  })

  it('replays the first response for the same Idempotency-Key', async () => {
    const first = await (
      await app.request('POST', '/v1/scrap-requests', {
        token,
        headers: key('same'),
        body: { institutionType: 'HOMETAX' },
      })
    ).json()
    const second = await app.request('POST', '/v1/scrap-requests', {
      token,
      headers: key('same'),
      body: { institutionType: 'HOMETAX' },
    })

    expect(second.status).toBe(202)
    expect((await second.json()).id).toBe(first.id)
  })

  it('requires an Idempotency-Key', async () => {
    const response = await app.request('POST', '/v1/scrap-requests', { token, body: { institutionType: 'BANK' } })

    expect(response.status).toBe(428)
  })

  it('refuses an institution without any link', async () => {
    const response = await app.request('POST', '/v1/scrap-requests', {
      token,
      headers: key('k-1'),
      body: { institutionType: 'PG' },
    })

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: 'INSTITUTION_NOT_CONNECTED', institutionType: 'PG' })
  })

  it('answers 404 for an unknown request', async () => {
    const response = await app.request('GET', '/v1/scrap-requests/scr_01JBQ0000000000000000000ZZ', { token })

    expect(response.status).toBe(404)
  })
})

describe('request-all and availability', () => {
  it('queues every connected institution and skips the ones cooling down', async () => {
    await app.request('POST', '/v1/scrap-requests', { token, headers: key('bank'), body: { institutionType: 'BANK' } })

    const all = await app.request('POST', '/v1/scrap-requests:request-all', { token, headers: key('all') })
    const availability = await (await app.request('GET', '/v1/scrap-requests:availability', { token })).json()

    expect(all.status).toBe(202)
    const body = await all.json()
    expect(body.items.map((item: { institutionType: string }) => item.institutionType)).toEqual(['HOMETAX'])
    expect(body.skipped).toEqual([expect.objectContaining({ institutionType: 'BANK', reason: 'COOLDOWN' })])
    expect(availability.items).toContainEqual(
      expect.objectContaining({
        institutionType: 'PG',
        isConnected: false,
        canRequest: false,
        reason: 'NOT_CONNECTED',
      }),
    )
    expect(availability.items).toContainEqual(
      expect.objectContaining({ institutionType: 'HOMETAX', isConnected: true, canRequest: false, reason: 'COOLDOWN' }),
    )
  })

  it('lets a company without links see that nothing is connected', async () => {
    const free = await app.signIn('owner@alfred.example', { companyId: DEMO_COMPANY_IDS.free })

    const body = await (await app.request('GET', '/v1/scrap-requests:availability', { token: free.token })).json()

    expect(body.items.every((item: { isConnected: boolean }) => !item.isConnected)).toBe(true)
  })
})
