import { afterEach, describe, expect, it } from 'vitest'
import { httpTestApp } from '../../../shared/testing/http-test-app.ts'
import { DEMO_HOLIDAYS, DEMO_TAX_PROFILE } from '../tax-demo.ts'
import { taxTestApp, TEST_TOKENS } from '../tax-http.testing.ts'
import type { TaxTestApp } from '../tax-http.testing.ts'

let app: TaxTestApp
afterEach(() => app.dispose())

describe('세무 설정 조회(GET /v1/tax-settings)', () => {
  it('저장한 적 없으면 기본 설정을 버전 0과 ETag로 줍니다', async () => {
    app = taxTestApp()

    const response = await app.send('/tax-settings')

    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe('"0"')
    expect(await response.json()).toEqual({
      fiscalYearEndMonth: 12,
      withholdingCycle: 'MONTHLY',
      withholdingSemiannualFrom: null,
      sincereFilingTarget: false,
      vatTaxpayerType: 'GENERAL',
      vatSimplifiedInvoiceIssuer: false,
      taxableCardRatioPpm: 1_000_000,
      vatSupplyAmounts: {},
      vatPreliminaryElections: {},
      version: 0,
      updatedAt: null,
    })
  })

  it('세무 대리인도 읽습니다', async () => {
    app = taxTestApp()

    const response = await app.send('/tax-settings', { token: 'agency' })

    expect(response.status).toBe(200)
  })
})

describe('세무 설정 수정(PATCH /v1/tax-settings)', () => {
  it('보낸 필드만 바꾸고 버전을 올립니다', async () => {
    app = taxTestApp()

    const response = await app.send('/tax-settings', {
      method: 'PATCH',
      body: {
        withholdingCycle: 'SEMIANNUAL',
        withholdingSemiannualFrom: '2027-H1',
        vatSupplyAmounts: { '2026-H2': 140_000_000 },
      },
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe('"1"')
    expect(body).toMatchObject({
      fiscalYearEndMonth: 12,
      withholdingCycle: 'SEMIANNUAL',
      withholdingSemiannualFrom: '2027-H1',
      vatSupplyAmounts: { '2026-H2': 140_000_000 },
      version: 1,
    })
    expect(body.updatedAt).not.toBeNull()
    expect(await (await app.send('/tax-settings')).json()).toEqual(body)
  })

  it('세무 대리인이 고칠 수 있습니다', async () => {
    app = taxTestApp()

    const response = await app.send('/tax-settings', {
      method: 'PATCH',
      token: 'agency',
      body: { sincereFilingTarget: true },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ sincereFilingTarget: true })
  })

  it('If-Match가 지금 버전과 같으면 고칩니다', async () => {
    app = taxTestApp()

    const response = await app.send('/tax-settings', {
      method: 'PATCH',
      ifMatch: '"0"',
      body: { taxableCardRatioPpm: 800_000 },
    })

    expect(response.status).toBe(200)
  })

  it('If-Match가 지금 버전과 다르면 412 VERSION_MISMATCH입니다', async () => {
    app = taxTestApp()
    await app.send('/tax-settings', { method: 'PATCH', body: { sincereFilingTarget: true } })

    const response = await app.send('/tax-settings', {
      method: 'PATCH',
      ifMatch: '"0"',
      body: { sincereFilingTarget: false },
    })

    expect(response.status).toBe(412)
    expect(await response.json()).toMatchObject({ code: 'VERSION_MISMATCH', currentVersion: 1 })
  })

  it.each([
    ['CORPORATION', 'client', { fiscalYearEndMonth: 13 }, 'FISCAL_YEAR_END_MONTH_OUT_OF_RANGE', 'fiscalYearEndMonth'],
    [
      'CORPORATION',
      'client',
      { withholdingCycle: 'SEMIANNUAL' },
      'SEMIANNUAL_START_REQUIRED',
      'withholdingSemiannualFrom',
    ],
    [
      'CORPORATION',
      'client',
      { withholdingSemiannualFrom: '2027-H1' },
      'SEMIANNUAL_START_NOT_ALLOWED',
      'withholdingSemiannualFrom',
    ],
    [
      'CORPORATION',
      'client',
      { withholdingCycle: 'SEMIANNUAL', withholdingSemiannualFrom: '2027-07' },
      'PERIOD_KEY_INVALID',
      'withholdingSemiannualFrom',
    ],
    [
      'INDIVIDUAL',
      'individual',
      { fiscalYearEndMonth: 3 },
      'INDIVIDUAL_FISCAL_YEAR_NOT_CALENDAR',
      'fiscalYearEndMonth',
    ],
    ['CORPORATION', 'client', { vatTaxpayerType: 'SIMPLIFIED' }, 'CORPORATION_CANNOT_BE_SIMPLIFIED', 'vatTaxpayerType'],
    [
      'INDIVIDUAL',
      'individual',
      { vatSimplifiedInvoiceIssuer: true },
      'INVOICE_ISSUER_REQUIRES_SIMPLIFIED',
      'vatSimplifiedInvoiceIssuer',
    ],
    [
      'CORPORATION',
      'client',
      { taxableCardRatioPpm: 1_000_001 },
      'TAXABLE_CARD_RATIO_OUT_OF_RANGE',
      'taxableCardRatioPpm',
    ],
    ['CORPORATION', 'client', { vatSupplyAmounts: { '2026-Q4': 1 } }, 'PERIOD_KEY_INVALID', 'vatSupplyAmounts.2026-Q4'],
    [
      'CORPORATION',
      'client',
      { vatPreliminaryElections: { '2027-1': 'EARLY_REFUND' } },
      'PERIOD_KEY_INVALID',
      'vatPreliminaryElections.2027-1',
    ],
    [
      'CORPORATION',
      'client',
      { vatSupplyAmounts: { '2026-H2': -1 } },
      'VAT_SUPPLY_AMOUNT_INVALID',
      'vatSupplyAmounts.2026-H2',
    ],
  ] as const)('%s 회사가 %s 토큰으로 %j를 보내면 422 %s입니다', async (_type, token, body, reason, field) => {
    app = taxTestApp()

    const response = await app.send('/tax-settings', { method: 'PATCH', token, body })

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: 'TAX_SETTING_INVALID', reason, field })
    expect(await (await app.send('/tax-settings', { token })).json()).toMatchObject({ version: 0 })
  })

  it('개인 간이과세자는 세금계산서 발급 여부를 함께 저장합니다', async () => {
    app = taxTestApp()

    const response = await app.send('/tax-settings', {
      method: 'PATCH',
      token: 'individual',
      body: { vatTaxpayerType: 'SIMPLIFIED', vatSimplifiedInvoiceIssuer: true },
    })

    expect(response.status).toBe(200)
  })

  it('정수가 아닌 결산월은 스키마에서 400 VALIDATION_FAILED입니다', async () => {
    app = taxTestApp()

    const response = await app.send('/tax-settings', { method: 'PATCH', body: { fiscalYearEndMonth: 3.5 } })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'VALIDATION_FAILED' })
  })
})

describe('세무 설정 접근 요건', () => {
  it('세무 기장 플랜이 없으면 조회·수정 모두 403 ENTITLEMENT_REQUIRED입니다', async () => {
    app = taxTestApp()

    const read = await app.send('/tax-settings', { token: 'free' })
    const update = await app.send('/tax-settings', { method: 'PATCH', token: 'free', body: {} })

    expect(read.status).toBe(403)
    expect(await read.json()).toMatchObject({ code: 'ENTITLEMENT_REQUIRED', requiredPlans: ['TAXATION'] })
    expect(update.status).toBe(403)
    expect(await update.json()).toMatchObject({ code: 'ENTITLEMENT_REQUIRED' })
  })

  it('세무 설정 권한이 없으면 403 PERMISSION_DENIED입니다', async () => {
    app = taxTestApp()

    const response = await app.send('/tax-settings', { token: 'viewer' })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'PERMISSION_DENIED', permission: 'tax-setting:read' })
  })

  it('세무 약관 재동의 전이면 403 TERMS_REAGREEMENT_REQUIRED입니다', async () => {
    app = taxTestApp()

    const response = await app.send('/tax-settings', { token: 'pendingTerms' })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'TERMS_REAGREEMENT_REQUIRED' })
  })

  it('데모 계정은 읽기만 합니다', async () => {
    app = taxTestApp()

    const read = await app.send('/tax-settings', { token: 'demo' })
    const update = await app.send('/tax-settings', {
      method: 'PATCH',
      token: 'demo',
      body: { sincereFilingTarget: true },
    })

    expect(read.status).toBe(200)
    expect(update.status).toBe(403)
    expect(await update.json()).toMatchObject({ code: 'PERMISSION_DENIED', permission: 'tax-setting:update' })
  })
})

describe('저장한 세무 설정과 세무 달력(GET /v1/tax-calendar)', () => {
  it('2027년 1기부터 반기 납부로 저장하면 그 앞은 매월, 그 반기부터 반기 의무입니다', async () => {
    app = taxTestApp({ profiles: [DEMO_TAX_PROFILE], holidays: DEMO_HOLIDAYS })
    const withholdingOf = async (year: number) => {
      const { items } = await (await app.send(`/tax-calendar?year=${year}`)).json()
      return items
        .filter((item: { taxType: string }) => item.taxType === 'WITHHOLDING_TAX')
        .map((item: { kind: string; periodKey: string }) => `${item.kind}:${item.periodKey}`)
    }

    const saved = await app.send('/tax-settings', {
      method: 'PATCH',
      body: { withholdingCycle: 'SEMIANNUAL', withholdingSemiannualFrom: '2027-H1' },
    })

    expect(saved.status).toBe(200)
    expect(await withholdingOf(2026)).toHaveLength(12)
    expect((await withholdingOf(2026)).every((key: string) => key.startsWith('MONTHLY:'))).toBe(true)
    expect(await withholdingOf(2027)).toEqual(['MONTHLY:2026-12', 'SEMIANNUAL:2027-H1'])
  })

  it('3월 결산으로 저장하면 법인세 확정 신고가 6월 말로 옮겨 갑니다', async () => {
    app = taxTestApp({ profiles: [DEMO_TAX_PROFILE], holidays: DEMO_HOLIDAYS })
    const annualOf = async () => {
      const { items } = await (await app.send('/tax-calendar?year=2026')).json()
      return items.filter(
        (item: { taxType: string; kind: string }) => item.taxType === 'CORPORATE_TAX' && item.kind === 'ANNUAL',
      )
    }

    const before = await annualOf()
    await app.send('/tax-settings', { method: 'PATCH', body: { fiscalYearEndMonth: 3 } })
    const after = await annualOf()

    expect(before).toMatchObject([{ periodEnd: '2025-12-31', statutoryDue: '2026-03-31' }])
    expect(after).toMatchObject([{ periodStart: '2025-04-01', periodEnd: '2026-03-31', statutoryDue: '2026-06-30' }])
  })
})

describe('앱 저장소의 세무 설정(TaxStoreLive)', () => {
  it('앱 전체 저장소(메모리 또는 SQLite)에 저장하고 다시 읽습니다', async () => {
    const whole = httpTestApp({ tokens: Object.entries(TEST_TOKENS), basePath: '/v1', defaultToken: 'client' })
    app = { send: (path) => whole.request('GET', path), dispose: whole.dispose }

    const patched = await whole.json('PATCH', '/tax-settings', {
      body: { fiscalYearEndMonth: 6, vatPreliminaryElections: { '2027-H1': 'EARLY_REFUND' } },
      ifMatch: '"0"',
    })
    const read = await whole.json('GET', '/tax-settings')

    expect(patched.status).toBe(200)
    expect(read.body).toEqual(patched.body)
    expect(read.headers.get('etag')).toBe('"1"')
  })
})
