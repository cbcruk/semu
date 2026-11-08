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

describe('대화', () => {
  it('대화를 시작하고 이어 쓰고 다시 읽습니다', async () => {
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

  it('쓰기 도구는 실행하지 않고 사용자 확인 단계와 함께 제안합니다', async () => {
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

  it('구성원의 도구는 그 역할의 권한으로 좁힙니다', async () => {
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

  it('무료 회사는 세무·노무 문의, 재무 요약, 세금계산서 발행 도구를 씁니다', async () => {
    const { token } = await app.signIn('owner@semu.example', { companyId: FREE_COMPANY_ID })

    const tools = await (await app.request('GET', '/v1/assistant-tools', { token })).json()

    expect(tools.items).toEqual([
      { tool: 'KNOWLEDGE_QA', mode: 'READ' },
      { tool: 'FINANCE_SUMMARY', mode: 'READ' },
      { tool: 'ISSUE_TAX_INVOICE', mode: 'CONFIRM' },
    ])
  })

  it('같은 회사의 다른 사용자에게는 대화를 보여 주지 않습니다', async () => {
    const owner = await app.signIn('owner@semu.example')
    const member = await app.signIn('member@semu.example')
    const { conversationId } = await (
      await app.request('POST', '/v1/conversations', { token: owner.token, body: { message: '안녕하세요' } })
    ).json()

    const peek = await app.request('GET', `/v1/conversations/${conversationId}`, { token: member.token })

    expect(peek.status).toBe(404)
    expect(await peek.json()).toMatchObject({ code: 'CONVERSATION_NOT_FOUND' })
  })

  it('대화를 지웁니다', async () => {
    const { token } = await app.signIn('owner@semu.example')
    const { conversationId } = await (
      await app.request('POST', '/v1/conversations', { token, body: { message: '안녕하세요' } })
    ).json()

    const removed = await app.request('DELETE', `/v1/conversations/${conversationId}`, { token })

    expect(removed.status).toBe(204)
    expect((await app.request('GET', `/v1/conversations/${conversationId}`, { token })).status).toBe(404)
    expect((await (await app.request('GET', '/v1/conversations', { token })).json()).items).toEqual([])
  })

  it('세무 약관에 동의하지 않은 세무 기장 고객은 막습니다', async () => {
    const { token } = await app.signIn('sole@semu.example')

    const response = await app.request('POST', '/v1/conversations', { token, body: { message: '안녕하세요' } })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'TERMS_REAGREEMENT_REQUIRED', termCodes: ['TAX_SERVICE'] })
  })

  it('수임 세무 대리인 직원은 기본으로 비서를 쓸 수 없습니다 (D5)', async () => {
    const { token } = await app.signIn('agent@agency.example')

    const response = await app.request('POST', '/v1/conversations', { token, body: { message: '안녕하세요' } })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'PERMISSION_DENIED', permission: 'conversation:create' })
  })

  it('빈 메시지는 거절합니다', async () => {
    const { token } = await app.signIn('owner@semu.example')

    const response = await app.request('POST', '/v1/conversations', { token, body: { message: '' } })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'VALIDATION_FAILED' })
  })

  it('토큰이 없으면 401입니다', async () => {
    expect((await app.request('GET', '/v1/conversations')).status).toBe(401)
  })
})

describe('지원사업 공고', () => {
  it('오늘 신청 가능한 공고만 마감 임박순으로, 상시 모집은 마지막에 보여 줍니다', async () => {
    const { token } = await app.signIn('owner@semu.example')

    const body = await (await app.request('GET', '/v1/grants', { token })).json()

    expect(body.items.map((g: { id: string }) => g.id)).toEqual([
      DEMO_GRANT_IDS.seoulIt,
      DEMO_GRANT_IDS.nationwide,
      DEMO_GRANT_IDS.busanManufacturing,
    ])
    expect(body.totalCount).toBe(3)
  })

  it('회사 업종·지역에 맞는 공고를 추천합니다', async () => {
    const { token } = await app.signIn('owner@semu.example')

    const body = await (await app.request('GET', '/v1/grant-recommendations', { token })).json()

    expect(body.items.map((g: { id: string }) => g.id)).toEqual([DEMO_GRANT_IDS.seoulIt, DEMO_GRANT_IDS.nationwide])
  })

  it('업종이 비어 있는 회사는 업종으로 거르지 않습니다', async () => {
    const { token } = await app.signIn('owner@semu.example', { companyId: FREE_COMPANY_ID })

    const body = await (await app.request('GET', '/v1/grant-recommendations', { token })).json()

    expect(body.items.map((g: { id: string }) => g.id)).toEqual([DEMO_GRANT_IDS.seoulIt, DEMO_GRANT_IDS.nationwide])
  })

  it('세무 약관 동의 전에도 지원사업 공고를 보여 줍니다', async () => {
    const { token } = await app.signIn('sole@semu.example')

    const body = await (await app.request('GET', '/v1/grant-recommendations', { token })).json()

    expect(body.items.map((g: { id: string }) => g.id)).toEqual([
      DEMO_GRANT_IDS.nationwide,
      DEMO_GRANT_IDS.busanManufacturing,
    ])
  })

  it('공고 하나를 읽고, 없는 공고는 404입니다', async () => {
    const { token } = await app.signIn('member@semu.example')

    const found = await app.request('GET', `/v1/grants/${DEMO_GRANT_IDS.closed}`, { token })
    const missing = await app.request('GET', '/v1/grants/grt_01JBQ0000000000000000000ZZ', { token })

    expect(found.status).toBe(200)
    expect(missing.status).toBe(404)
    expect(await missing.json()).toMatchObject({ code: 'GRANT_NOT_FOUND' })
  })
})
