import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEMO_COMPANY_IDS } from '../../identity-access/demo-seed.ts'
import { cookieOf, makeTestApp } from '../../identity-access/testing-http.ts'
import type { TestApp } from '../../identity-access/testing-http.ts'

const CORPORATION_WITHHOLDING = 'fil_01JBQ0000000000000000000D1'
const CORPORATION_VAT = 'fil_01JBQ0000000000000000000D2'
const INDIVIDUAL_WITHHOLDING = 'fil_01JBQ0000000000000000000D3'

let app: TestApp

beforeEach(() => {
  app = makeTestApp()
})

afterEach(() => app.dispose())

/** 대리인 담당자로 로그인해 `companyId` 회사 토큰과, 같은 세션의 대리인 범위로 바꾸는 함수를 돌려줍니다. */
async function agent(companyId: string = DEMO_COMPANY_IDS.corporation) {
  const signedIn = await app.signIn('agent@agency.example', { companyId })
  let cookie = signedIn.cookie
  return {
    companyToken: signedIn.token,
    async agencyToken(): Promise<string> {
      const response = await app.request('POST', '/v1/auth/sessions:switch-agency', { cookie })
      if (response.status !== 200) throw new Error(`switch-agency failed: ${response.status}`)
      cookie = cookieOf(response)
      return (await response.json()).accessToken
    },
  }
}

function ids(body: { items: Array<{ id: string }> }): string[] {
  return body.items.map((item) => item.id)
}

describe('GET /v1/agency/filings', () => {
  it('lists the filings of assigned companies only, nearest due first, with the company and agency actions', async () => {
    const token = await (await agent()).agencyToken()

    const response = await app.request('GET', '/v1/agency/filings', { token })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(ids(body)).toEqual([CORPORATION_WITHHOLDING, INDIVIDUAL_WITHHOLDING, CORPORATION_VAT])
    expect(body.items[0]).toMatchObject({
      taxType: 'WITHHOLDING_TAX',
      status: 'REQUESTED',
      company: { id: DEMO_COMPANY_IDS.corporation, name: '주식회사 세무' },
      allowedActions: ['START_REVIEW', 'CANCEL'],
    })
    expect(body.items[1]).toMatchObject({
      company: { id: DEMO_COMPANY_IDS.individual, name: '세무 상점' },
      allowedActions: ['REQUEST', 'START_REVIEW', 'CANCEL'],
    })
    expect(body.items.map((item: { company: { id: string } }) => item.company.id)).not.toContain(DEMO_COMPANY_IDS.demo)
  })

  it('filters by company, tax type, status and due date', async () => {
    const token = await (await agent()).agencyToken()
    const list = async (query: string) =>
      ids(await (await app.request('GET', `/v1/agency/filings?${query}`, { token })).json())

    expect(await list(`companyId=${DEMO_COMPANY_IDS.individual}`)).toEqual([INDIVIDUAL_WITHHOLDING])
    expect(await list('taxType=VAT')).toEqual([CORPORATION_VAT])
    expect(await list('status=REQUESTED')).toEqual([CORPORATION_WITHHOLDING])
    expect(await list('dueTo=2026-12-31')).toEqual([CORPORATION_WITHHOLDING, INDIVIDUAL_WITHHOLDING])
    expect(await list('dueFrom=2027-01-01')).toEqual([CORPORATION_VAT])
    expect(await list('open=false')).toEqual([])
  })

  it('answers 404 COMPANY_NOT_FOUND for a company that is not assigned to the agent', async () => {
    const token = await (await agent()).agencyToken()

    const response = await app.request('GET', `/v1/agency/filings?companyId=${DEMO_COMPANY_IDS.demo}`, { token })

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: 'COMPANY_NOT_FOUND' })
  })

  it('pages across companies with a cursor', async () => {
    const token = await (await agent()).agencyToken()

    const first = await (await app.request('GET', '/v1/agency/filings?limit=2', { token })).json()
    const second = await (
      await app.request('GET', `/v1/agency/filings?limit=2&cursor=${first.nextCursor}`, { token })
    ).json()

    expect(ids(first)).toEqual([CORPORATION_WITHHOLDING, INDIVIDUAL_WITHHOLDING])
    expect(ids(second)).toEqual([CORPORATION_VAT])
    expect(second).not.toHaveProperty('nextCursor')
  })

  it('refuses a customer with 403, since a company token cannot call /agency/*', async () => {
    const { token } = await app.signIn('owner@semu.example')

    const response = await app.request('GET', '/v1/agency/filings', { token })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'TOKEN_SCOPE_MISMATCH', requiredScope: 'AGENCY' })
  })
})

describe('GET /v1/agency/action-cards', () => {
  it('shows the cards a filing command opened in a company, across companies, until they close', async () => {
    const session = await agent(DEMO_COMPANY_IDS.individual)
    const requested = await app.request('POST', `/v1/filings/${INDIVIDUAL_WITHHOLDING}:request`, {
      token: session.companyToken,
      body: { submitDue: '2026-11-07' },
    })
    expect(requested.status).toBe(200)
    const token = await session.agencyToken()

    const open = await (await app.request('GET', '/v1/agency/action-cards', { token })).json()
    const closed = await (await app.request('GET', '/v1/agency/action-cards?status=CLOSED', { token })).json()
    const corporation = await (
      await app.request('GET', `/v1/agency/action-cards?companyId=${DEMO_COMPANY_IDS.corporation}`, { token })
    ).json()

    expect(open.items).toEqual([
      expect.objectContaining({
        kind: 'SUBMIT_MATERIALS',
        status: 'OPEN',
        dueDate: '2026-11-07',
        subject: expect.objectContaining({ filingId: INDIVIDUAL_WITHHOLDING }),
        company: { id: DEMO_COMPANY_IDS.individual, name: '세무 상점' },
      }),
    ])
    expect(closed.items).toEqual([])
    expect(corporation.items).toEqual([])
    const companies = await (await app.request('GET', '/v1/agency/companies', { token })).json()
    expect(companies.items.find((c: { id: string }) => c.id === DEMO_COMPANY_IDS.individual).workload).toMatchObject({
      openActionCardCount: 1,
    })
  })

  it('answers 404 for an unassigned company, 403 for a live company token and 401 for the token the switch revoked', async () => {
    const session = await agent()
    const token = await session.agencyToken()
    const otherSession = await app.signIn('agent@agency.example')

    const unassigned = await app.request('GET', `/v1/agency/action-cards?companyId=${DEMO_COMPANY_IDS.free}`, {
      token,
    })
    const companyToken = await app.request('GET', '/v1/agency/action-cards', { token: otherSession.token })
    const revoked = await app.request('GET', '/v1/agency/action-cards', { token: session.companyToken })

    expect(unassigned.status).toBe(404)
    expect(companyToken.status).toBe(403)
    expect(await companyToken.json()).toMatchObject({ code: 'TOKEN_SCOPE_MISMATCH', requiredScope: 'AGENCY' })
    expect(revoked.status).toBe(401)
  })
})
