import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TestApp } from '../common/test-app.ts'
import { testApp } from '../common/test-app.ts'

let app: TestApp
beforeEach(() => {
  app = testApp()
})
afterEach(() => app.dispose())

const ECOPRO = 'ptn_01JBQ000000000000000000001'

describe('거래처(/v1/partners)', () => {
  it('미정산 금액은 분류된 증빙 합계에서 연결 금액을 뺀 실시간 값입니다', async () => {
    const ecopro = await app.send('GET', `/v1/partners/${ECOPRO}`)
    const office = await app.send('GET', '/v1/partners/ptn_01JBQ000000000000000000002')

    expect(await ecopro.json()).toMatchObject({ outstanding: { salesAmount: 0, purchaseAmount: 0 } })
    expect(await office.json()).toMatchObject({ outstanding: { salesAmount: 0, purchaseAmount: 11_000_000 } })
  })

  it('거래처를 만들면 사업자 상태를 조회하고 계좌번호를 가립니다', async () => {
    const response = await app.send('POST', '/v1/partners', {
      body: {
        type: 'CORPORATE_BUSINESS',
        roles: ['PURCHASE'],
        name: '폐업상사',
        representativeName: '홍길동',
        businessNumber: '123-45-67899',
        bankAccounts: [{ bankCode: '004', accountNumber: '111-222-333444' }],
      },
    })

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      businessNumber: '1234567899',
      businessStatus: 'CLOSED',
      bankAccounts: [{ bankCode: '004', accountNumberMasked: '****3444', isPrimary: true }],
    })
  })

  it('같은 사업자번호의 거래처는 409로 거절합니다', async () => {
    const response = await app.send('POST', '/v1/partners', {
      body: {
        type: 'CORPORATE_BUSINESS',
        roles: ['SALES'],
        name: '에코프로 중복',
        representativeName: '대표',
        businessNumber: '1108100011',
      },
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'PARTNER_BUSINESS_NUMBER_DUPLICATE', partnerId: ECOPRO })
  })

  it('사업자 거래처는 사업자번호가 있어야 합니다', async () => {
    const response = await app.send('POST', '/v1/partners', {
      body: { type: 'INDIVIDUAL_BUSINESS', roles: ['SALES'], name: '개인사업자', representativeName: '대표' },
    })

    expect(response.status).toBe(422)
  })

  it('거래처를 지우면 기록은 남기고 목록에서 뺍니다', async () => {
    const deleted = await app.send('DELETE', `/v1/partners/${ECOPRO}`)
    const after = await app.send('GET', `/v1/partners/${ECOPRO}`)
    const listed = await app.send('GET', '/v1/partners?role=SALES')

    expect(deleted.status).toBe(204)
    expect(after.status).toBe(404)
    expect(((await listed.json()) as { items: unknown[] }).items).toEqual([])
  })
})
