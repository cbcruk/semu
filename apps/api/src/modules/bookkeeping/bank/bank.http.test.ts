import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { systemAccountTitleIdOf } from '../account-titles/system-account-titles.ts'
import type { TestApp } from '../common/test-app.ts'
import { testApp } from '../common/test-app.ts'

let app: TestApp
beforeEach(() => {
  app = testApp()
})
afterEach(() => app.dispose())

interface TransactionBody {
  id: string
  summary: string
  amount: number
  version: number
  settlement: { status: string; linkedAmount: number; links: Array<{ evidenceId: string; amount: number }> }
}

async function transaction(summary: string): Promise<TransactionBody> {
  const response = await app.send('GET', `/v1/bank-transactions?search=${encodeURIComponent(summary)}`)
  return ((await response.json()) as { items: TransactionBody[] }).items.find((row) => row.summary === summary)!
}

describe('계좌 /v1/bank-accounts', () => {
  it('계좌번호를 가리고 총 자산·총 부채를 요약합니다', async () => {
    const accounts = await app.send('GET', '/v1/bank-accounts')
    const summary = await app.send('GET', '/v1/bank-accounts:summary')

    const { items } = (await accounts.json()) as { items: Array<{ alias: string; accountNumberMasked: string }> }
    expect(items.find((row) => row.alias === '운영자금')?.accountNumberMasked).toBe('****9012')
    expect(JSON.stringify(items)).not.toContain('789012')
    expect(await summary.json()).toMatchObject({
      activeAccountCount: 3,
      totalAssetAmount: 73_450_000,
      totalLiabilityAmount: 100_000_000,
    })
  })

  it('은행이 준 마감 잔액이 거래 후 잔액으로 만든 값보다 우선합니다', async () => {
    const accounts = await app.send('GET', '/v1/bank-accounts')
    const { items } = (await accounts.json()) as { items: Array<{ id: string; alias: string }> }
    const main = items.find((row) => row.alias === '운영자금')!
    const response = await app.send('GET', `/v1/bank-accounts/${main.id}/balances?from=2026-10-28&to=2026-10-31`)

    expect(await response.json()).toEqual({
      openingBalance: 59_830_000,
      items: [
        { date: '2026-10-28', closingBalance: 69_730_000, source: 'DERIVED' },
        { date: '2026-10-31', closingBalance: 71_450_000, source: 'SCRAPED' },
      ],
    })
  })
})

describe('입출금 /v1/bank-transactions', () => {
  it('증빙 연결 상태는 분류·거래처·연결 금액으로 정합니다', async () => {
    expect((await transaction('에코프로비엠')).settlement).toMatchObject({
      status: 'MATCHED',
      linkedAmount: 33_000_000,
    })
    expect((await transaction('에코프로비엠 선급')).settlement.status).toBe('UNMATCHED')
    expect((await transaction('오피스디포')).settlement.status).toBe('UNMATCHED')
    expect((await transaction('이자')).settlement.status).toBe('NOT_APPLICABLE')
  })

  it('증빙 연결 상태로 거릅니다', async () => {
    const response = await app.send('GET', '/v1/bank-transactions?settlement=MATCHED')

    const { items } = (await response.json()) as { items: TransactionBody[] }
    expect(items.map((row) => row.summary)).toEqual(['에코프로비엠'])
  })

  it('출금에는 매입 증빙만 연결하고 매출 증빙은 거절합니다', async () => {
    const out = await transaction('오피스디포')
    const purchases = await app.send('GET', '/v1/evidence?side=PURCHASE&source=TAX_INVOICE')
    const [invoice] = ((await purchases.json()) as { items: Array<{ id: string }> }).items
    const sales = await app.send('GET', '/v1/evidence?side=SALES&source=MALL')
    const [mall] = ((await sales.json()) as { items: Array<{ id: string }> }).items

    const refused = await app.send('POST', `/v1/bank-transactions/${out.id}:link`, {
      body: { links: [{ evidenceId: mall!.id, amount: 1_000 }] },
    })
    const linked = await app.send('POST', `/v1/bank-transactions/${out.id}:link`, {
      body: { links: [{ evidenceId: invoice!.id, amount: 11_000_000 }] },
      headers: { 'if-match': `"${out.version}"` },
    })

    expect(refused.status).toBe(422)
    expect(await refused.json()).toMatchObject({ code: 'SETTLEMENT_LINK_INVALID', reason: 'SIDE_MISMATCH' })
    expect(await linked.json()).toMatchObject({ settlement: { status: 'MATCHED', linkedAmount: 11_000_000 } })
  })

  it('증빙 합계를 넘는 연결은 거절합니다', async () => {
    const deposit = await transaction('에코프로비엠 선급')
    const sales = await app.send('GET', '/v1/evidence?side=SALES&source=TAX_INVOICE')
    const [invoice] = ((await sales.json()) as { items: Array<{ id: string }> }).items
    const response = await app.send('POST', `/v1/bank-transactions/${deposit.id}:link`, {
      body: { links: [{ evidenceId: invoice!.id, amount: 1_000 }] },
    })

    expect(await response.json()).toMatchObject({ reason: 'EXCEEDS_EVIDENCE' })
  })

  it('출금은 출금에 쓰는 계정과목으로만 분류합니다', async () => {
    const telecom = await transaction('통신비 자동이체')
    const refused = await app.send('POST', `/v1/bank-transactions/${telecom.id}:classify`, {
      body: { accountTitleId: systemAccountTitleIdOf('non_op_income.tax_refund') },
    })
    const done = await app.send('POST', `/v1/bank-transactions/${telecom.id}:classify`, {
      body: { accountTitleId: systemAccountTitleIdOf('sga.communication') },
    })

    expect(await refused.json()).toMatchObject({ reason: 'SCOPE_MISMATCH', scope: 'WITHDRAWAL' })
    expect(await done.json()).toMatchObject({ classification: { status: 'CLASSIFIED', method: 'MANUAL' } })
  })

  it('메모는 50자까지입니다', async () => {
    const telecom = await transaction('통신비 자동이체')
    const response = await app.send('PATCH', `/v1/bank-transactions/${telecom.id}`, { body: { memo: 'x'.repeat(51) } })

    expect(response.status).toBe(400)
  })
})
