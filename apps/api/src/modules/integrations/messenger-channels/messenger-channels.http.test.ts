import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEMO_COMPANY_IDS } from '../../identity-access/identity-access.public.ts'
import { makeTestApp } from '../../identity-access/testing-http.ts'
import type { TestApp } from '../../identity-access/testing-http.ts'
import { DEMO_CHANNEL_TOKENS } from '../demo-seed.ts'

let app: TestApp
let token: string

beforeEach(async () => {
  app = makeTestApp()
  token = (await app.signIn('owner@semu.example')).token
})

afterEach(() => app.dispose())

describe('messenger channels', () => {
  it('previews and connects a channel to the signed-in company, once', async () => {
    const preview = await app.request('POST', '/v1/messenger-channels:preview', {
      token,
      body: { token: DEMO_CHANNEL_TOKENS.valid },
    })
    const connected = await app.request('POST', '/v1/messenger-channels', {
      token,
      body: { token: DEMO_CHANNEL_TOKENS.valid },
    })
    const again = await app.request('POST', '/v1/messenger-channels', {
      token,
      body: { token: DEMO_CHANNEL_TOKENS.valid },
    })
    const list = await (await app.request('GET', '/v1/messenger-channels', { token })).json()

    expect(await preview.json()).toMatchObject({ messengerType: 'KAKAOTALK', channelName: '세무상담' })
    expect(connected.status).toBe(201)
    expect(again.status).toBe(422)
    expect(await again.json()).toMatchObject({ code: 'CHAT_CHANNEL_TOKEN_USED' })
    expect(list.items.map((item: { channelName: string }) => item.channelName)).toEqual(['#semu-tax', '세무상담'])
  })

  it('answers each token failure with its own code', async () => {
    const codes = await Promise.all(
      ['unknown', DEMO_CHANNEL_TOKENS.used, DEMO_CHANNEL_TOKENS.expired].map(
        async (value) =>
          (
            await (
              await app.request('POST', '/v1/messenger-channels:preview', { token, body: { token: value } })
            ).json()
          ).code,
      ),
    )

    expect(codes).toEqual(['CHAT_CHANNEL_TOKEN_INVALID', 'CHAT_CHANNEL_TOKEN_USED', 'CHAT_CHANNEL_TOKEN_EXPIRED'])
  })
})

describe('hometax delegations', () => {
  it('lets a taxation customer agree to the pending delegation', async () => {
    const sole = await app.signIn('sole@semu.example')

    const list = await (await app.request('GET', '/v1/hometax-delegations', { token: sole.token })).json()
    const id = list.items[0].id
    const rejected = await app.request('POST', `/v1/hometax-delegations/${id}:agree`, {
      token: sole.token,
      body: { hometaxLoginId: 'kim', hometaxPassword: 'wrong-pw' },
    })
    const agreed = await app.request('POST', `/v1/hometax-delegations/${id}:agree`, {
      token: sole.token,
      body: { hometaxLoginId: 'kim', hometaxPassword: 'right-pw' },
    })
    const twice = await app.request('POST', `/v1/hometax-delegations/${id}:agree`, {
      token: sole.token,
      body: { hometaxLoginId: 'kim', hometaxPassword: 'right-pw' },
    })

    expect(list.items[0]).toMatchObject({ status: 'REQUESTED', allowedActions: ['AGREE'] })
    expect(rejected.status).toBe(422)
    expect(await agreed.json()).toMatchObject({ status: 'AGREED', allowedActions: [] })
    expect(twice.status).toBe(409)
  })

  it('asks a free company to subscribe to TAXATION first', async () => {
    const free = await app.signIn('owner@semu.example', { companyId: DEMO_COMPANY_IDS.free })

    const response = await app.request('GET', '/v1/hometax-delegations', { token: free.token })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'ENTITLEMENT_REQUIRED', requiredPlans: ['TAXATION'] })
  })
})

describe('business statuses', () => {
  it('looks up a business number and rejects a malformed one', async () => {
    const active = await app.request('GET', '/v1/business-statuses/1238145600', { token })
    const closed = await app.request('GET', '/v1/business-statuses/1234567898', { token })
    const malformed = await app.request('GET', '/v1/business-statuses/123-45', { token })

    expect(await active.json()).toEqual({ businessNumber: '1238145600', status: 'ACTIVE', taxType: 'GENERAL' })
    expect(await closed.json()).toMatchObject({ status: 'CLOSED', closedOn: '2025-12-31' })
    expect(malformed.status).toBe(400)
  })
})
