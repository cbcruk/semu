import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeTestApp } from '../../src/modules/identity-access/testing-http.ts'

const app = makeTestApp()
const ON = '2026-11-30'

let owner = ''

beforeAll(async () => {
  owner = (await app.signIn('owner@semu.example')).token
})

afterAll(() => app.dispose())

async function get(path: string): Promise<any> {
  const response = await app.request('GET', path, { token: owner })
  expect(response.status).toBe(200)
  return response.json()
}

describe('Integrations → Bookkeeping → Tax 연결', () => {
  let before: any

  it('홈택스 수집 묶음을 Bookkeeping의 증빙 원장에 넣습니다', async () => {
    before = await get(`/v1/vat-estimates/current?on=${ON}`)

    const accepted = await app.request('POST', '/v1/scrap-requests', {
      token: owner,
      headers: { 'idempotency-key': 'hometax-1' },
      body: { institutionType: 'HOMETAX' },
    })
    expect(accepted.status).toBe(202)
    const job = await get(`/v1/scrap-requests/${(await accepted.json()).id}`)
    expect(job.status).toBe('SUCCEEDED')

    const evidence = await get('/v1/evidence?side=SALES&source=TAX_INVOICE&from=2026-11-01&to=2026-11-01')
    expect(evidence.items).toHaveLength(2)
    expect(
      evidence.items
        .map((row: { amounts: { totalAmount: number } }) => row.amounts.totalAmount)
        .toSorted((a: number, b: number) => a - b),
    ).toEqual([10_000, 20_000])
  })

  it('들어온 증빙을 부가세 예상 세액에 반영합니다', async () => {
    const after = await get(`/v1/vat-estimates/current?on=${ON}`)

    expect(after.period).toEqual({ start: '2026-10-01', end: '2026-12-31', unit: 'QUARTER' })
    expect(after.outputTax - before.outputTax).toBe(910 + 1_819)
  })

  it('Bookkeeping 홈 카드에 Tax의 예상 세액·과세기간·신고 기한을 그대로 보여 줍니다', async () => {
    const estimate = await get(`/v1/vat-estimates/current?on=${ON}`)
    const home = await get(`/v1/reports/home-summary?date=${ON}`)

    expect(home.vat).toMatchObject({
      periodStart: estimate.period.start,
      periodEnd: estimate.period.end,
      estimatedTaxAmount: estimate.estimatedTax,
      dueDate: '2027-01-25',
    })
  })
})

describe('Bookkeeping → Integrations 연결', () => {
  it('새 거래처를 Integrations의 사업자 상태 조회로 확인합니다', async () => {
    const created = await app.request('POST', '/v1/partners', {
      token: owner,
      body: {
        type: 'CORPORATE_BUSINESS',
        roles: ['PURCHASE'],
        name: '폐업상사',
        representativeName: '홍길동',
        businessNumber: '2208100018',
      },
    })
    const lookup = await get('/v1/business-statuses/2208100018')

    expect(created.status).toBe(201)
    expect(lookup).toMatchObject({ status: 'CLOSED', closedOn: '2025-12-31' })
    expect((await created.json()).businessStatus).toBe('CLOSED')
  })
})
