import { beforeEach, describe, expect, it } from 'vitest'
import { SEED } from '../../src/db/seed'
import { toPlainDate } from '../../src/lib/plain-date'
import { upsertScrapedGiros } from '../../src/modules/bookkeeping/giros/giros.service'
import { createMemoryTaxAlertNotifier, sendTaxPaymentAlerts } from '../../src/modules/bookkeeping/giros/tax-payment-alerts'
import { CORP, createTestContext, type TestContext, USERS } from '../helpers/test-app'

const base = `/api/company/${CORP}/giros`
const payPath = (id: string): string => `/api/v2/company/${CORP}/giros/${id}/payment`
const PASSWORD = '9137'

describe('giros', () => {
  let ctx: TestContext
  let admin: string

  beforeEach(async () => {
    ctx = await createTestContext()
    admin = await ctx.token(USERS.admin, CORP)
  })

  const json = async (method: string, path: string, body?: unknown, token = admin): Promise<{ status: number; body: Record<string, unknown> }> => {
    const response = await ctx.call(token, method, path, body === undefined ? {} : { json: body })
    return { status: response.status, body: (await response.json()) as Record<string, unknown> }
  }

  const addBankAccount = (): string => {
    ctx.db
      .prepare(
        `INSERT INTO bank_accounts (id, company_id, bank_code, account_number_enc, account_number_digest, account_number_tail, account_name, account_type, created_at, updated_at)
         VALUES ('ba-test', ?, '004', ?, 'digest-test', '345678', '운영자금', '01', 't', 't')`,
      )
      .run(CORP, ctx.cipher.encrypt('11122345678'))
    return 'ba-test'
  }

  it('counts bills per status and serializes amounts as strings', async () => {
    expect((await json('GET', `${base}/summary`)).body).toEqual({ todo: 2, unknown: 1, done: 1, hidden: 0 })
    const detail = (await json('GET', `${base}/giro-vat`)).body
    expect(detail).toMatchObject({
      status: 'todo',
      giro_type: '국세',
      pay_amount: '1200000',
      detail: { pay_amount: '1200000', pay_date1: '2026-11-03' },
      last_action_history: { status: 'created', memo: '', giro: 'giro-vat' },
    })
    const todo = (await json('GET', `${base}?status=todo`)).body as { count: number }
    expect(todo.count).toBe(2)
    const raw = (await json('GET', `${base}/status=todo`)).body as { count: number }
    expect(raw.count).toBe(2)
    const search = (await json('GET', `${base}?search=${encodeURIComponent('주민세')}`)).body as { results: { id: string }[] }
    expect(search.results.map((row) => row.id)).toEqual(['giro-local'])
  })

  it('applies manual completion and hiding only from open statuses', async () => {
    const done = await json('POST', `${base}/giro-vat/manual_done`, { memo: '' })
    expect(done.body).toMatchObject({ status: 'done', done_reason: 'manual', last_action_history: { status: 'manual_done', username: 'u-admin@example.com' } })
    expect((await json('POST', `${base}/giro-vat/manual_done`, { memo: '' })).status).toBe(409)
    expect((await json('POST', `${base}/giro-vat/hide`, { memo: '' })).status).toBe(409)
    expect((await json('POST', `${base}/giro-unknown/hide`, { memo: '' })).body).toMatchObject({ status: 'hidden', done_reason: null })
    expect((await json('GET', `${base}/summary`)).body).toEqual({ todo: 1, unknown: 0, done: 2, hidden: 1 })
    const all = (await json('GET', base)).body as { results: { id: string }[] }
    expect(all.results.map((row) => row.id)).not.toContain('giro-unknown')
  })

  it('pays from a registered account without storing the password', async () => {
    const accountId = addBankAccount()
    const candidates = (await ctx.call(admin, 'GET', `${base}/giro-vat/payment-accounts`).then((r) => r.json())) as Record<string, unknown>[]
    expect(candidates).toContainEqual({ id: `bank_account:${accountId}`, source: 'registered', bank_code: '004', account_number: '*******5678', account_name: '운영자금' })

    const paid = await json('POST', payPath('giro-vat'), { payment_account_id: `bank_account:${accountId}`, account_password: PASSWORD, request_id: 'r-1' })
    expect(paid.status).toBe(200)
    expect(paid.body).toMatchObject({ status: 'succeeded', giro: { status: 'done', done_reason: 'paid_in_app', last_action_history: { status: 'paid' } } })

    const again = await json('POST', payPath('giro-vat'), { payment_account_id: `bank_account:${accountId}`, account_password: PASSWORD, request_id: 'r-1' })
    expect(again.body).toMatchObject({ status: 'succeeded' })
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM giro_payments').get()).toEqual({ n: 1 })
    expect((await json('POST', payPath('giro-vat'), { bank_code: '004', account_number: '11122345678', account_password: PASSWORD })).status).toBe(409)

    const tables = ctx.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    for (const { name } of tables) {
      for (const row of ctx.db.prepare(`SELECT * FROM "${name}"`).all() as Record<string, unknown>[]) {
        for (const [column, value] of Object.entries(row)) {
          if (!(name === 'users' && column === 'password_hash')) expect(column).not.toMatch(/password/)
          expect(String(value), `${name}.${column}`).not.toBe(PASSWORD)
          expect(String(value), `${name}.${column}`).not.toContain(`"${PASSWORD}"`)
        }
      }
    }
    const payment = ctx.db.prepare('SELECT account_number_enc, account_number_tail FROM giro_payments').get() as { account_number_enc: string; account_number_tail: string }
    expect(payment.account_number_enc).not.toContain('11122345678')
    expect(payment.account_number_tail).toBe('5678')

    const recent = (await ctx.call(admin, 'GET', `${base}/giro-local/payment-accounts`).then((r) => r.json())) as { source: string; account_number: string }[]
    expect(recent[0]).toMatchObject({ source: 'recent', account_number: '*******5678' })
  })

  it('keeps the bill open when the gateway rejects the payment', async () => {
    const failed = await json('POST', payPath('giro-local'), { bank_code: '004', account_number: '111-22-345678', account_password: '0000' })
    expect(failed.body).toMatchObject({ status: 'failed', result_code: 'E101', giro: { status: 'todo', last_action_history: { status: 'pay_failed' } } })
    expect((await json('POST', payPath('giro-done'), { bank_code: '004', account_number: '11122345678', account_password: PASSWORD })).status).toBe(409)
  })

  it('scopes the v2 payment path to the token company and blocks demo writes', async () => {
    const other = await ctx.token(USERS.admin, SEED.companies.free)
    expect((await json('POST', payPath('giro-vat'), { bank_code: '004', account_number: '11122345678', account_password: PASSWORD }, other)).body).toMatchObject({
      code: 'COMPANY_MISMATCH',
    })
    const demo = await ctx.token(USERS.demo, CORP)
    expect((await json('POST', payPath('giro-vat'), { bank_code: '004', account_number: '11122345678', account_password: PASSWORD }, demo)).body).toMatchObject({
      code: 'DEMO_READ_ONLY',
    })
  })

  it('upserts a full refresh and marks vanished bills as unknown', () => {
    const result = upsertScrapedGiros(
      ctx.db,
      CORP,
      [
        { e_pay_no: '2611260000000000002', giro_type: '지방세', slip_type: '지방세고지내역조회_법인번호', tax_name: '주민세(사업소분)', pay_amount: 62_500, due_date: '2026-11-30', detail: {} },
        { e_pay_no: '0126112500000000009', giro_type: '국세', slip_type: '국세고지내역조회_사업자번호', tax_name: '법인세', pay_amount: 900_000, due_date: '2026-11-25', detail: { pay_amount: 900_000 } },
        { e_pay_no: '0126093000000000003', giro_type: '국세', slip_type: '국세고지내역조회_사업자번호', tax_name: '원천세', pay_amount: 340_000, detail: {}, is_paid: true },
      ],
      ctx.clock.now(),
    )
    expect(result).toEqual({ inserted: 1, updated: 2, marked_unknown: 1 })
    const statuses = Object.fromEntries((ctx.db.prepare('SELECT e_pay_no, status, done_reason FROM giros WHERE company_id = ?').all(CORP) as { e_pay_no: string; status: string; done_reason: string | null }[]).map((row) => [row.e_pay_no, `${row.status}/${row.done_reason}`]))
    expect(statuses).toMatchObject({
      '0126110300000000001': 'unknown/null',
      '0126112500000000009': 'todo/null',
      '0126093000000000003': 'done/scraped',
    })
    expect(upsertScrapedGiros(ctx.db, CORP, [], ctx.clock.now()).marked_unknown).toBe(2)
  })

  it('sends due reminders once per business day', async () => {
    const notifier = createMemoryTaxAlertNotifier()
    expect(await sendTaxPaymentAlerts(ctx, notifier, toPlainDate('2026-11-01'))).toEqual({ sent: 0, skipped: 0, holiday: true })
    expect(await sendTaxPaymentAlerts(ctx, notifier, toPlainDate('2026-11-02'))).toEqual({ sent: 1, skipped: 0, holiday: false })
    expect(notifier.sent[0]).toMatchObject({ userId: 'u-admin', giroId: 'giro-vat', daysLeft: 1 })
    expect(await sendTaxPaymentAlerts(ctx, notifier, toPlainDate('2026-11-02'))).toEqual({ sent: 0, skipped: 1, holiday: false })
    expect(await sendTaxPaymentAlerts(ctx, notifier, toPlainDate('2026-11-03'))).toEqual({ sent: 1, skipped: 0, holiday: false })
    expect(await sendTaxPaymentAlerts(ctx, notifier, toPlainDate('2026-11-04'))).toEqual({ sent: 0, skipped: 0, holiday: false })
  })
})
