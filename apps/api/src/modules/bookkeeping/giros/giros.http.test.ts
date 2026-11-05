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

describe('/v1/giros', () => {
  it('summarizes bills to pay', async () => {
    const response = await app.send('GET', '/v1/giros:summary')

    expect(await response.json()).toEqual({ todoCount: 2, todoAmount: 1_262_500, unknownCount: 1 })
  })

  it('lists allowed commands per status', async () => {
    const unknown = await app.send('GET', `/v1/giros/${WITHHOLDING_UNKNOWN}`)
    const done = await app.send('GET', `/v1/giros/${PAID}`)

    expect(await unknown.json()).toMatchObject({ status: 'UNKNOWN', allowedCommands: ['MARK_PAID', 'HIDE'] })
    expect(await done.json()).toMatchObject({ status: 'DONE', allowedCommands: [] })
  })

  it('marks a bill paid by hand and records the actor', async () => {
    const response = await app.send('POST', `/v1/giros/${WITHHOLDING_UNKNOWN}:mark-paid`, {
      body: { memo: '은행 창구 납부' },
    })

    expect(await response.json()).toMatchObject({
      status: 'DONE',
      doneReason: 'MARKED_BY_USER',
      history: [{ type: 'CREATED' }, { type: 'MARKED_PAID', memo: '은행 창구 납부', actorUserId: expect.any(String) }],
    })
  })

  it('refuses a command the status does not allow', async () => {
    const response = await app.send('POST', `/v1/giros/${PAID}:hide`)

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ currentStatus: 'DONE', command: 'HIDE' })
  })
})

describe('POST /v1/giros/{id}:pay', () => {
  it('requires an Idempotency-Key', async () => {
    const response = await app.send('POST', `/v1/giros/${VAT}:pay`, { body: PAYMENT })

    expect(response.status).toBe(428)
  })

  it('pays once per key', async () => {
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

  it('keeps the bill open when the bank rejects', async () => {
    const response = await app.send('POST', `/v1/giros/${VAT}:pay`, {
      body: { ...PAYMENT, accountPassword: FAKE_WRONG_PASSWORD },
      headers: { 'idempotency-key': 'pay-3' },
    })
    const after = await app.send('GET', `/v1/giros/${VAT}`)

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: 'GIRO_PAYMENT_FAILED', resultCode: 'E101' })
    expect(await after.json()).toMatchObject({ status: 'TODO' })
  })

  it('refuses paying national tax from K bank', async () => {
    const response = await app.send('POST', `/v1/giros/${VAT}:pay`, {
      body: { ...PAYMENT, bankCode: '089' },
      headers: { 'idempotency-key': 'pay-4' },
    })

    expect(await response.json()).toMatchObject({ resultCode: 'E201' })
  })
})
