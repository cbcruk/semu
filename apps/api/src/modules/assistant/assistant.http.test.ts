import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestApp } from '../identity-access/testing-http.ts'
import type { TestApp } from '../identity-access/testing-http.ts'
import { DEMO_GRANT_IDS } from './assistant-seed.ts'

const FREE_COMPANY_ID = 'cmp_01JBQ000000000000000000003'

let app: TestApp

beforeEach(() => {
  app = makeTestApp()
})

afterEach(() => app.dispose())

describe('conversations', () => {
  it('starts a conversation, continues it and reads it back', async () => {
    const { token } = await app.signIn('owner@semu.example')

    const started = await app.request('POST', '/v1/conversations', {
      token,
      body: { message: '부가세 신고 기한이 언제인가요?' },
    })
    expect(started.status).toBe(201)
    const { conversationId, reply } = await started.json()
    expect(conversationId).toMatch(/^cnv_/)
    expect(reply).toMatchObject({ role: 'ASSISTANT', toolProposals: [] })

    const sent = await app.request('POST', `/v1/conversations/${conversationId}/messages`, {
      token,
      body: { message: '이번 달 급여 내역 보여 줘' },
    })
    expect(sent.status).toBe(201)
    expect((await sent.json()).reply.toolProposals).toEqual([
      { tool: 'LOOKUP_PAYROLL', arguments: {}, requiresConfirmation: false },
    ])

    const detail = await (await app.request('GET', `/v1/conversations/${conversationId}`, { token })).json()
    expect(detail).toMatchObject({ id: conversationId, title: '부가세 신고 기한이 언제인가요?' })
    expect(detail.messages.map((m: { role: string }) => m.role)).toEqual(['USER', 'ASSISTANT', 'USER', 'ASSISTANT'])
    const list = await (await app.request('GET', '/v1/conversations', { token })).json()
    expect(list.items.map((c: { id: string }) => c.id)).toEqual([conversationId])
  })

  it('proposes write tools with a confirmation step instead of running them', async () => {
    const { token } = await app.signIn('owner@semu.example')

    const response = await app.request('POST', '/v1/conversations', {
      token,
      body: { message: '○○상사에 100,000원 세금계산서 발행해 주세요.' },
    })

    expect((await response.json()).reply.toolProposals).toEqual([
      {
        tool: 'ISSUE_TAX_INVOICE',
        arguments: { request: '○○상사에 100,000원 세금계산서 발행해 주세요.' },
        requiresConfirmation: true,
      },
    ])
  })

  it('narrows the tools of a member to the permissions of their roles', async () => {
    const { token } = await app.signIn('member@semu.example')

    const tools = await (await app.request('GET', '/v1/assistant-tools', { token })).json()
    const reply = await (
      await app.request('POST', '/v1/conversations', { token, body: { message: '직원 급여 보여 줘' } })
    ).json()

    expect(tools.items.map((t: { tool: string }) => t.tool)).toEqual([
      'KNOWLEDGE_QA',
      'FINANCE_SUMMARY',
      'ISSUE_TAX_INVOICE',
    ])
    expect(reply.reply.toolProposals).toEqual([])
  })

  it('gives a free company the knowledge, finance and tax invoice tools', async () => {
    const { token } = await app.signIn('owner@semu.example', { companyId: FREE_COMPANY_ID })

    const tools = await (await app.request('GET', '/v1/assistant-tools', { token })).json()

    expect(tools.items).toEqual([
      { tool: 'KNOWLEDGE_QA', mode: 'READ' },
      { tool: 'FINANCE_SUMMARY', mode: 'READ' },
      { tool: 'ISSUE_TAX_INVOICE', mode: 'CONFIRM' },
    ])
  })

  it('hides a conversation from other users of the same company', async () => {
    const owner = await app.signIn('owner@semu.example')
    const member = await app.signIn('member@semu.example')
    const { conversationId } = await (
      await app.request('POST', '/v1/conversations', { token: owner.token, body: { message: '안녕하세요' } })
    ).json()

    const peek = await app.request('GET', `/v1/conversations/${conversationId}`, { token: member.token })

    expect(peek.status).toBe(404)
    expect(await peek.json()).toMatchObject({ code: 'CONVERSATION_NOT_FOUND' })
  })

  it('deletes a conversation', async () => {
    const { token } = await app.signIn('owner@semu.example')
    const { conversationId } = await (
      await app.request('POST', '/v1/conversations', { token, body: { message: '안녕하세요' } })
    ).json()

    const removed = await app.request('DELETE', `/v1/conversations/${conversationId}`, { token })

    expect(removed.status).toBe(204)
    expect((await app.request('GET', `/v1/conversations/${conversationId}`, { token })).status).toBe(404)
    expect((await (await app.request('GET', '/v1/conversations', { token })).json()).items).toEqual([])
  })

  it('blocks a taxation customer who has not agreed to the tax terms', async () => {
    const { token } = await app.signIn('sole@semu.example')

    const response = await app.request('POST', '/v1/conversations', { token, body: { message: '안녕하세요' } })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'TERMS_REAGREEMENT_REQUIRED', termCodes: ['TAX_SERVICE'] })
  })

  it('lets agency staff use the assistant for an assigned company', async () => {
    const { token } = await app.signIn('agent@agency.example')

    const response = await app.request('POST', '/v1/conversations', { token, body: { message: '안녕하세요' } })

    expect(response.status).toBe(201)
  })

  it('rejects an empty message', async () => {
    const { token } = await app.signIn('owner@semu.example')

    const response = await app.request('POST', '/v1/conversations', { token, body: { message: '' } })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'VALIDATION_FAILED' })
  })

  it('answers 401 without a token', async () => {
    expect((await app.request('GET', '/v1/conversations')).status).toBe(401)
  })
})

describe('grants', () => {
  it('lists only calls open today, closest deadline first and always-open last', async () => {
    const { token } = await app.signIn('owner@semu.example')

    const body = await (await app.request('GET', '/v1/grants', { token })).json()

    expect(body.items.map((g: { id: string }) => g.id)).toEqual([
      DEMO_GRANT_IDS.seoulIt,
      DEMO_GRANT_IDS.nationwide,
      DEMO_GRANT_IDS.busanManufacturing,
    ])
    expect(body.totalCount).toBe(3)
  })

  it('recommends grants matching the company industry and region', async () => {
    const { token } = await app.signIn('owner@semu.example')

    const body = await (await app.request('GET', '/v1/grant-recommendations', { token })).json()

    expect(body.items.map((g: { id: string }) => g.id)).toEqual([DEMO_GRANT_IDS.seoulIt, DEMO_GRANT_IDS.nationwide])
  })

  it('does not filter by industry for a company whose industry is unclear', async () => {
    const { token } = await app.signIn('owner@semu.example', { companyId: FREE_COMPANY_ID })

    const body = await (await app.request('GET', '/v1/grant-recommendations', { token })).json()

    expect(body.items.map((g: { id: string }) => g.id)).toEqual([DEMO_GRANT_IDS.seoulIt, DEMO_GRANT_IDS.nationwide])
  })

  it('shows grants even before the tax terms are agreed', async () => {
    const { token } = await app.signIn('sole@semu.example')

    const body = await (await app.request('GET', '/v1/grant-recommendations', { token })).json()

    expect(body.items.map((g: { id: string }) => g.id)).toEqual([
      DEMO_GRANT_IDS.nationwide,
      DEMO_GRANT_IDS.busanManufacturing,
    ])
  })

  it('reads one grant and answers 404 for an unknown one', async () => {
    const { token } = await app.signIn('member@semu.example')

    const found = await app.request('GET', `/v1/grants/${DEMO_GRANT_IDS.closed}`, { token })
    const missing = await app.request('GET', '/v1/grants/grt_01JBQ0000000000000000000ZZ', { token })

    expect(found.status).toBe(200)
    expect(missing.status).toBe(404)
    expect(await missing.json()).toMatchObject({ code: 'GRANT_NOT_FOUND' })
  })
})
