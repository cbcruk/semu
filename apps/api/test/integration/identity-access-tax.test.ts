import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEMO_COMPANY_IDS, DEMO_PASSWORD } from '../../src/modules/identity-access/demo-seed.ts'
import { makeTestApp } from '../../src/modules/identity-access/testing-http.ts'

const app = makeTestApp()

let owner = ''

beforeAll(async () => {
  owner = (await app.signIn('owner@semu.example')).token
})

afterAll(() => app.dispose())

describe('Identity & Access + Billing → Tax 연결', () => {
  it('Identity & Access의 회사와 Billing의 요금제로 세무 일정을 만듭니다', async () => {
    const response = await app.request('GET', '/v1/tax-calendar?year=2026', { token: owner })
    const { items } = await response.json()

    expect(response.status).toBe(200)
    expect(items.filter((item: { taxType: string; kind: string }) => item.kind === 'PRELIMINARY')).toHaveLength(2)
    expect(
      items.find(
        (item: { taxType: string; periodKey: string }) =>
          item.taxType === 'WITHHOLDING_TAX' && item.periodKey === '2026-09',
      ),
    ).toMatchObject({ dueDate: '2026-10-12', filingId: null })
  })

  it('회사에 배정된 대리인 직원은 고객 대신 원천세를 제출하고, 배정되지 않은 회사로는 로그인하지 못합니다(404)', async () => {
    /** 데모 법인의 10월분 원천세입니다. 자료 요청 중(`REQUESTED`)입니다. */
    const october = '/v1/filings/fil_01JBQ0000000000000000000D1'
    const agent = await app.signIn('agent@agency.example', { companyId: DEMO_COMPANY_IDS.corporation })
    const filing = await (await app.request('GET', october, { token: agent.token })).json()

    let version = filing.version
    for (const { code } of filing.requirements.filter((item: { autoLinked: boolean }) => !item.autoLinked)) {
      const answered = await app.request('PATCH', `${october}/requirements/${code}`, {
        token: agent.token,
        body: { response: 'NOT_APPLICABLE' },
      })
      version = (await answered.json()).version
    }
    const submitted = await app.request('POST', `${october}:submit`, { token: agent.token, ifMatch: `"${version}"` })
    const history = await (await app.request('GET', `${october}/history`, { token: owner })).json()
    const unassigned = await app.request('POST', '/v1/auth/sessions', {
      body: { email: 'agent@agency.example', password: DEMO_PASSWORD, companyId: DEMO_COMPANY_IDS.free },
    })

    expect(agent.body).toMatchObject({ company: { actorKind: 'AGENCY' } })
    expect(submitted.status).toBe(200)
    expect(history.items.at(-1)).toMatchObject({ type: 'SUBMIT', actorKind: 'AGENCY', onBehalfOf: 'CLIENT' })
    expect(unassigned.status).toBe(404)
    expect(await unassigned.json()).toMatchObject({ code: 'COMPANY_NOT_FOUND' })
  })
})
