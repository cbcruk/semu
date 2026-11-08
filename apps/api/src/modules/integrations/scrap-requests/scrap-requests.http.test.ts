import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEMO_COMPANY_IDS } from '../../identity-access/identity-access.public.ts'
import { makeTestApp } from '../../identity-access/testing-http.ts'
import type { TestApp } from '../../identity-access/testing-http.ts'

let app: TestApp
let token: string

beforeEach(async () => {
  app = makeTestApp()
  token = (await app.signIn('owner@semu.example')).token
})

afterEach(() => app.dispose())

const key = (value: string) => ({ 'idempotency-key': value })

describe('수집 요청(POST /v1/scrap-requests)', () => {
  it('수동 수집을 받아 실행하고 다음 요청은 쿨다운 동안 막습니다', async () => {
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

  it('같은 Idempotency-Key면 첫 응답을 그대로 다시 줍니다', async () => {
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

  it('Idempotency-Key가 있어야 합니다', async () => {
    const response = await app.request('POST', '/v1/scrap-requests', { token, body: { institutionType: 'BANK' } })

    expect(response.status).toBe(428)
  })

  it('연동이 하나도 없는 기관은 수집 요청을 거절합니다', async () => {
    const response = await app.request('POST', '/v1/scrap-requests', {
      token,
      headers: key('k-1'),
      body: { institutionType: 'PG' },
    })

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: 'INSTITUTION_NOT_CONNECTED', institutionType: 'PG' })
  })

  it('모르는 수집 요청이면 404로 답합니다', async () => {
    const response = await app.request('GET', '/v1/scrap-requests/scr_01JBQ0000000000000000000ZZ', { token })

    expect(response.status).toBe(404)
  })
})

describe('전체 수집과 수집 가능 여부', () => {
  it('연동된 기관을 모두 대기열에 넣고 쿨다운 중인 기관은 건너뜁니다', async () => {
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

  it('연동이 없는 회사에는 연동된 기관이 없다고 보여 줍니다', async () => {
    const free = await app.signIn('owner@semu.example', { companyId: DEMO_COMPANY_IDS.free })

    const body = await (await app.request('GET', '/v1/scrap-requests:availability', { token: free.token })).json()

    expect(body.items.every((item: { isConnected: boolean }) => !item.isConnected)).toBe(true)
  })
})
