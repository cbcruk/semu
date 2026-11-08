import { afterEach, describe, expect, it } from 'vitest'
import { DEMO_TAX_PROFILE, DEMO_VAT_EVIDENCE } from '../tax-demo.ts'
import { taxTestApp } from '../tax-http.testing.ts'
import type { TaxTestApp } from '../tax-http.testing.ts'

let app: TaxTestApp
afterEach(() => app.dispose())

describe('현재 예상 부가세 조회(GET /v1/vat-estimates/current)', () => {
  it('법인은 주어진 날짜가 속한 분기의 부가세를 예상합니다', async () => {
    app = taxTestApp({ profiles: [DEMO_TAX_PROFILE], vatEvidence: DEMO_VAT_EVIDENCE })

    const response = await app.send('/vat-estimates/current?on=2026-11-05')

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      period: { start: '2026-10-01', end: '2026-12-31', unit: 'QUARTER' },
      asOf: '2026-11-05',
      outputTax: 100_000,
      inputTax: 30_000,
      estimatedTax: 70_000,
      cardSplitEstimated: true,
    })
  })

  it('개인은 반기로 계산하고 세무 설정이 없으면 카드 과세 비율을 100%로 봅니다', async () => {
    app = taxTestApp({ vatEvidence: DEMO_VAT_EVIDENCE })

    const response = await app.send('/vat-estimates/current?on=2026-11-05', { token: 'individual' })

    expect(await response.json()).toMatchObject({ period: { start: '2026-07-01', unit: 'HALF' }, outputTax: 100_000 })
  })

  it('없는 날짜는 거절합니다', async () => {
    app = taxTestApp()

    const response = await app.send('/vat-estimates/current?on=2026-02-30')

    expect(response.status).toBe(400)
  })
})

describe('예상 부가세 추이 조회(GET /v1/vat-estimates)', () => {
  it('시작한 반기마다 한 점을 주고 신고 건이 없으면 예상 세액을 씁니다', async () => {
    app = taxTestApp({ vatEvidence: DEMO_VAT_EVIDENCE })

    const response = await app.send('/vat-estimates?years=1')
    const { items } = await response.json()

    expect(items[0]).toMatchObject({ half: 1 })
    expect(items.every((item: { source: string }) => item.source === 'ESTIMATED')).toBe(true)
  })
})
