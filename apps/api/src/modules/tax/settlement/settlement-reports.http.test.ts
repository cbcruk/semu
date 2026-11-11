import { afterEach, describe, expect, it } from 'vitest'
import { DEMO_TAX_PROFILE } from '../tax-demo.ts'
import { httpTestApp } from '../../../shared/testing/http-test-app.ts'
import { taxTestApp, TEST_TOKENS } from '../tax-http.testing.ts'
import type { TaxTestApp } from '../tax-http.testing.ts'
import { profitLossMonth, profitLossMonths } from './settlement.testing.ts'

let app: TaxTestApp
afterEach(() => app.dispose())

/** 2025 사업연도(12월 결산) 전체를 올리는 본문입니다. 지난 해라 실제 시계와 상관없이 결산 기준일이 오늘보다 늦지 않습니다. */
const 전체연도 = { closedThrough: '2025-12-31', months: profitLossMonths('2025-01', 12) }

function upload(body: unknown, request: { ifMatch?: string; fiscalYear?: number } = {}) {
  return app.send(`/settlement-reports/profit-loss/${request.fiscalYear ?? 2025}`, {
    method: 'PUT',
    token: 'agency',
    body,
    ...(request.ifMatch === undefined ? {} : { ifMatch: request.ifMatch }),
  })
}

describe('결산 손익 업로드(PUT /v1/settlement-reports/profit-loss/{fiscalYear})', () => {
  it('세무 대리인이 올리면 계산 섹션과 당기 누계를 채워 버전 1로 줍니다', async () => {
    app = taxTestApp()

    const response = await upload(전체연도)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe('"1"')
    expect(body).toMatchObject({
      fiscalYear: 2025,
      period: { start: '2025-01-01', end: '2025-12-31' },
      closedThrough: '2025-12-31',
      version: 1,
    })
    expect(body.months).toHaveLength(12)
    expect(body.months[0].sections.NET_INCOME).toEqual({ amount: 2_600_000, accounts: [] })
    expect(body.total.REVENUE).toEqual({
      amount: 120_000_000,
      accounts: [{ name: '상품매출', amount: 120_000_000 }],
    })
    expect(body.total.NET_INCOME.amount).toBe(31_200_000)
  })

  it('다시 올리면 통째로 바꾸고 버전을 올립니다', async () => {
    app = taxTestApp()
    await upload({ closedThrough: '2025-06-30', months: profitLossMonths('2025-01', 6) })

    const response = await upload(전체연도, { ifMatch: '"1"' })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ closedThrough: '2025-12-31', version: 2 })
  })

  it('버전이 다르면 412입니다', async () => {
    app = taxTestApp()
    await upload(전체연도)

    const response = await upload(전체연도, { ifMatch: '"0"' })

    expect(response.status).toBe(412)
    expect(await response.json()).toMatchObject({ code: 'VERSION_MISMATCH', currentVersion: 1 })
  })

  it('처음 올릴 때 If-Match는 "0"입니다', async () => {
    app = taxTestApp()

    expect((await upload(전체연도, { ifMatch: '"0"' })).status).toBe(200)
  })

  it('달이 빠지면 422입니다', async () => {
    app = taxTestApp()

    const response = await upload({ closedThrough: '2025-12-31', months: profitLossMonths('2025-01', 11) })

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({
      code: 'SETTLEMENT_SNAPSHOT_INVALID',
      reason: 'MONTH_MISSING',
      field: 'months',
    })
  })

  it('계정 합이 섹션 합계와 다르면 422입니다', async () => {
    app = taxTestApp()
    const month = profitLossMonth('2025-01', {
      REVENUE: { amount: 10, accounts: [{ name: '상품매출', amount: 9 }] },
    })

    const response = await upload({ closedThrough: '2025-01-31', months: [month] })

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({
      reason: 'SECTION_TOTAL_MISMATCH',
      field: 'months[0].sections.REVENUE.amount',
    })
  })

  it('세무 설정의 결산월로 사업연도 기간을 정합니다', async () => {
    app = taxTestApp({ profiles: [{ ...DEMO_TAX_PROFILE, fiscalYearEndMonth: 3 }] })

    const response = await upload(
      { closedThrough: '2025-03-31', months: profitLossMonths('2024-04', 12) },
      { fiscalYear: 2025 },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ period: { start: '2024-04-01', end: '2025-03-31' } })
  })

  it('고객은 올릴 수 없습니다', async () => {
    app = taxTestApp()

    const response = await app.send('/settlement-reports/profit-loss/2025', { method: 'PUT', body: 전체연도 })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ permission: 'settlement-report:upload' })
  })

  it('세무 기장 플랜이 없는 회사에는 올릴 수 없습니다', async () => {
    app = taxTestApp()

    const response = await app.send('/settlement-reports/profit-loss/2025', {
      method: 'PUT',
      token: 'free',
      body: 전체연도,
    })

    expect(response.status).toBe(403)
  })
})

describe('결산 손익계산서 조회(GET /v1/settlement-reports/profit-loss/{fiscalYear})', () => {
  it('고객이 올라온 손익계산서를 ETag와 함께 읽습니다', async () => {
    app = taxTestApp()
    await upload(전체연도)

    const response = await app.send('/settlement-reports/profit-loss/2025')
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe('"1"')
    expect(body.months.map((month: { month: string }) => month.month)).toEqual(
      profitLossMonths('2025-01', 12).map((month) => month.month),
    )
    expect(Object.keys(body.total)).toEqual([
      'REVENUE',
      'COST_OF_SALES',
      'GROSS_PROFIT',
      'SELLING_AND_ADMINISTRATIVE_EXPENSES',
      'OPERATING_INCOME',
      'NON_OPERATING_INCOME',
      'NON_OPERATING_EXPENSES',
      'INCOME_TAXES',
      'NET_INCOME',
    ])
  })

  it('올리지 않은 사업연도는 404입니다', async () => {
    app = taxTestApp()

    const response = await app.send('/settlement-reports/profit-loss/2024')

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: 'SETTLEMENT_REPORT_NOT_FOUND' })
  })

  it('세무 기장 플랜이 없으면 403입니다', async () => {
    app = taxTestApp()

    const response = await app.send('/settlement-reports/profit-loss/2025', { token: 'free' })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'ENTITLEMENT_REQUIRED' })
  })

  it('세무 약관 재동의 전이면 403입니다', async () => {
    app = taxTestApp()

    const response = await app.send('/settlement-reports/profit-loss/2025', { token: 'pendingTerms' })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'TERMS_REAGREEMENT_REQUIRED' })
  })

  it('데모 계정도 읽습니다', async () => {
    app = taxTestApp()
    await upload(전체연도)

    expect((await app.send('/settlement-reports/profit-loss/2025', { token: 'demo' })).status).toBe(200)
  })

  it('다른 회사 대리인은 이 회사 스냅샷을 보지 못합니다', async () => {
    app = taxTestApp()
    await upload(전체연도)

    const response = await app.send('/settlement-reports/profit-loss/2025', { token: 'otherAgency' })

    expect(response.status).toBe(404)
  })
})

describe('결산 보고서 목록(GET /v1/settlement-reports)', () => {
  it('올린 사업연도를 내림차순으로 줍니다', async () => {
    app = taxTestApp()
    await upload({ closedThrough: '2024-12-31', months: profitLossMonths('2024-01', 12) }, { fiscalYear: 2024 })
    await upload(전체연도)

    const response = await app.send('/settlement-reports')

    expect(response.status).toBe(200)
    expect((await response.json()).items).toEqual([
      { report: 'PROFIT_LOSS', fiscalYear: 2025, closedThrough: '2025-12-31', updatedAt: expect.any(String) },
      { report: 'PROFIT_LOSS', fiscalYear: 2024, closedThrough: '2024-12-31', updatedAt: expect.any(String) },
    ])
  })

  it('올린 것이 없으면 빈 목록입니다', async () => {
    app = taxTestApp()

    expect(await (await app.send('/settlement-reports')).json()).toEqual({ items: [] })
  })
})

describe('앱 저장소의 결산 스냅샷(TaxStoreLive)', () => {
  it('앱 전체 저장소(메모리 또는 SQLite)에 저장하고 다시 읽습니다', async () => {
    const whole = httpTestApp({ tokens: Object.entries(TEST_TOKENS), basePath: '/v1', defaultToken: 'client' })
    app = { send: (path) => whole.request('GET', path), dispose: whole.dispose }

    const uploaded = await whole.json('PUT', '/settlement-reports/profit-loss/2025', {
      token: 'agency',
      body: 전체연도,
      ifMatch: '"0"',
    })
    const read = await whole.json('GET', '/settlement-reports/profit-loss/2025')

    expect(uploaded.status).toBe(200)
    expect(read.body).toEqual(uploaded.body)
    expect(read.headers.get('etag')).toBe('"1"')
  })
})
