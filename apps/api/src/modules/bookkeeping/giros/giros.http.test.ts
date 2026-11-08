import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TestApp } from '../common/test-app.ts'
import { testApp } from '../common/test-app.ts'
import { FAKE_WRONG_PASSWORD } from '../ports/giro-payment-gateway.ts'

let app: TestApp
beforeEach(() => {
  app = testApp()
})
afterEach(() => app.dispose())

const VAT = 'gir_01JBQ000000000000000000001'
const WITHHOLDING_UNKNOWN = 'gir_01JBQ000000000000000000003'
const PAID = 'gir_01JBQ000000000000000000004'
const PAYMENT = { bankCode: '004', accountNumber: '123-456-789012', accountPassword: '1234' }

describe('지로 고지서 /v1/giros', () => {
  it('납부할 고지서를 요약합니다', async () => {
    const response = await app.send('GET', '/v1/giros:summary')

    expect(await response.json()).toEqual({ todoCount: 2, todoAmount: 1_262_500, unknownCount: 1 })
  })

  it('상태마다 보낼 수 있는 커맨드를 보여 줍니다', async () => {
    const unknown = await app.send('GET', `/v1/giros/${WITHHOLDING_UNKNOWN}`)
    const done = await app.send('GET', `/v1/giros/${PAID}`)

    expect(await unknown.json()).toMatchObject({ status: 'UNKNOWN', allowedCommands: ['MARK_PAID', 'HIDE'] })
    expect(await done.json()).toMatchObject({ status: 'DONE', allowedCommands: [] })
  })

  it('수동으로 납부 완료하면 처리한 사용자를 남깁니다', async () => {
    const response = await app.send('POST', `/v1/giros/${WITHHOLDING_UNKNOWN}:mark-paid`, {
      body: { memo: '은행 창구 납부' },
    })

    expect(await response.json()).toMatchObject({
      status: 'DONE',
      doneReason: 'MARKED_BY_USER',
      history: [{ type: 'CREATED' }, { type: 'MARKED_PAID', memo: '은행 창구 납부', actorUserId: expect.any(String) }],
    })
  })

  it('상태가 허용하지 않는 커맨드는 거절합니다', async () => {
    const response = await app.send('POST', `/v1/giros/${PAID}:hide`)

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ currentStatus: 'DONE', command: 'HIDE' })
  })
})

describe('앱 납부 POST /v1/giros/{id}:pay', () => {
  it('Idempotency-Key가 있어야 합니다', async () => {
    const response = await app.send('POST', `/v1/giros/${VAT}:pay`, { body: PAYMENT })

    expect(response.status).toBe(428)
  })

  it('키마다 한 번만 납부합니다', async () => {
    const headers = { 'idempotency-key': 'pay-1' }
    const first = await app.send('POST', `/v1/giros/${VAT}:pay`, { body: PAYMENT, headers })
    const replay = await app.send('POST', `/v1/giros/${VAT}:pay`, { body: PAYMENT, headers })
    const again = await app.send('POST', `/v1/giros/${VAT}:pay`, {
      body: PAYMENT,
      headers: { 'idempotency-key': 'pay-2' },
    })

    expect(await first.json()).toMatchObject({ status: 'DONE', doneReason: 'PAID_IN_APP' })
    expect(replay.status).toBe(200)
    expect(again.status).toBe(409)
  })

  it('은행이 거절하면 고지서를 납부 전으로 둡니다', async () => {
    const response = await app.send('POST', `/v1/giros/${VAT}:pay`, {
      body: { ...PAYMENT, accountPassword: FAKE_WRONG_PASSWORD },
      headers: { 'idempotency-key': 'pay-3' },
    })
    const after = await app.send('GET', `/v1/giros/${VAT}`)

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: 'GIRO_PAYMENT_FAILED', resultCode: 'E101' })
    expect(await after.json()).toMatchObject({ status: 'TODO' })
  })

  it('케이뱅크 계좌로는 국세를 납부할 수 없습니다', async () => {
    const response = await app.send('POST', `/v1/giros/${VAT}:pay`, {
      body: { ...PAYMENT, bankCode: '089' },
      headers: { 'idempotency-key': 'pay-4' },
    })

    expect(await response.json()).toMatchObject({ resultCode: 'E201' })
  })
})
