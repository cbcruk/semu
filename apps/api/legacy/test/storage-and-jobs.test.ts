import { describe, expect, it } from 'vitest'
import { SEED } from '../src/db/seed'
import { scheduleFilings } from '../src/jobs/schedule-filings'
import { sweepOrphanFiles } from '../src/jobs/sweep-orphan-files'
import { CORP, createTestContext, fileForm, pdfBytes, USERS } from './helpers/test-app'

describe('uploads', () => {
  const setup = async (maxUploadBytes?: number): Promise<{ ctx: Awaited<ReturnType<typeof createTestContext>>; admin: string; path: string }> => {
    const ctx = await createTestContext(maxUploadBytes === undefined ? {} : { maxUploadBytes })
    const admin = await ctx.token(USERS.admin, CORP)
    const agent = await ctx.token(USERS.agent)
    const filing = ctx.db.prepare("SELECT id, version FROM tax_filings WHERE company_id = ? AND tax_period_key = '2026-2-final'").get(CORP) as {
      id: string
      version: number
    }
    await ctx.call(agent, 'POST', `/api/desk/filings/${filing.id}/request`, { ifMatch: filing.version, json: { submit_due: '2027-01-15' } })
    return { ctx, admin, path: `/api/company/${CORP}/tax/surtax/${filing.id}/requirements/simple_receipt/files` }
  }

  it('rejects files whose content is not an allowed type', async () => {
    const { ctx, admin, path } = await setup()
    const response = await ctx.call(admin, 'POST', path, { form: fileForm(new TextEncoder().encode('MZ...'), 'invoice.pdf') })
    expect(response.status).toBe(415)
    expect(ctx.storage.objects.size).toBe(0)
  })

  it('rejects bodies above the size limit', async () => {
    const { ctx, admin, path } = await setup(1024)
    const big = new Uint8Array(4096).fill(0x41)
    big.set(new TextEncoder().encode('%PDF-'))
    expect((await ctx.call(admin, 'POST', path, { form: fileForm(big, 'big.pdf') })).status).toBe(413)
  })

  it('stores identical content once per company', async () => {
    const { ctx, admin, path } = await setup()
    await ctx.call(admin, 'POST', path, { form: fileForm(pdfBytes('same'), 'a.pdf') })
    const second = await ctx.call(admin, 'POST', path.replace('simple_receipt', 'ending_inventory'), { form: fileForm(pdfBytes('same'), 'b.pdf') })
    expect(second.status).toBe(201)
    expect(ctx.storage.objects.size).toBe(1)
    expect((ctx.db.prepare('SELECT COUNT(*) AS n FROM requirement_files').get() as { n: number }).n).toBe(2)
  })

  it('serves a client their own uploads and refuses other file IDs', async () => {
    const { ctx, admin, path } = await setup()
    await ctx.call(admin, 'POST', path, { form: fileForm(pdfBytes('mine'), 'mine.pdf') })
    const file = ctx.db.prepare('SELECT id FROM files LIMIT 1').get() as { id: string }
    expect((await ctx.call(admin, 'GET', `${path}/${file.id}`)).status).toBe(200)
    expect((await ctx.call(admin, 'GET', `${path.replace('simple_receipt', 'export_fx')}/${file.id}`)).status).toBe(404)
  })

  it('blocks cross-company references at the schema level', async () => {
    const { ctx, admin, path } = await setup()
    await ctx.call(admin, 'POST', path, { form: fileForm(pdfBytes('corp'), 'corp.pdf') })
    const file = ctx.db.prepare('SELECT id FROM files LIMIT 1').get() as { id: string }
    const other = ctx.db.prepare('SELECT id FROM tax_filings WHERE company_id = ? LIMIT 1').get(SEED.companies.individual) as { id: string }
    ctx.db.exec(`INSERT INTO filing_requirements (company_id, filing_id, code, label) VALUES ('${SEED.companies.individual}', '${other.id}', 'x', 'x')`)
    expect(() =>
      ctx.db.prepare('INSERT INTO requirement_files (company_id, filing_id, code, file_id) VALUES (?, ?, ?, ?)').run(SEED.companies.individual, other.id, 'x', file.id),
    ).toThrow(/FOREIGN KEY/)
  })

  it('sweeps blobs that no file row references', async () => {
    const { ctx } = await setup()
    await ctx.storage.put('c-corp/orphan', pdfBytes('orphan'))
    const later = new Date(Date.now() + 48 * 60 * 60 * 1000)
    expect(await sweepOrphanFiles(ctx.db, ctx.storage, later)).toEqual(['c-corp/orphan'])
  })
})

describe('scheduleFilings', () => {
  it('is idempotent', async () => {
    const ctx = await createTestContext()
    expect(scheduleFilings(ctx.db, ctx.clock)).toEqual({ created: 0, updated: 0, cancelled: 0 })
  })

  it('cancels monthly withholding and creates semiannual filings when the setting changes', async () => {
    const ctx = await createTestContext()
    ctx.db.prepare('UPDATE companies SET withholding_semiannual = 1 WHERE id = ?').run(CORP)
    const result = scheduleFilings(ctx.db, ctx.clock)
    expect(result.created).toBe(1)
    expect(result.cancelled).toBe(4)
    const statuses = ctx.db
      .prepare("SELECT tax_period_key, status FROM tax_filings WHERE company_id = ? AND tax_type = 'withholding_tax' ORDER BY tax_period_key")
      .all(CORP)
    expect(statuses).toContainEqual({ tax_period_key: '2026-H2-semiannual', status: 'scheduled' })
    expect(statuses).toContainEqual({ tax_period_key: '2026-10-payment', status: 'cancelled' })
  })

  it('recomputes deadlines when a temporary holiday is added', async () => {
    const ctx = await createTestContext()
    ctx.db.prepare("INSERT INTO public_holidays (date, name, kind) VALUES ('2026-11-10', '임시공휴일', 'temporary')").run()
    expect(scheduleFilings(ctx.db, ctx.clock).updated).toBeGreaterThan(0)
    const row = ctx.db.prepare("SELECT due_date FROM tax_filings WHERE company_id = ? AND tax_period_key = '2026-10-payment'").get(CORP) as {
      due_date: string
    }
    expect(row.due_date).toBe('2026-11-11')
  })

  it('creates payroll ledger items only for payroll customers', async () => {
    const ctx = await createTestContext({ schedule: false })
    ctx.db.prepare('UPDATE companies SET has_payroll_plan = 1 WHERE id = ?').run(CORP)
    scheduleFilings(ctx.db, ctx.clock)
    const codes = ctx.db
      .prepare(
        "SELECT r.code, r.auto_linked FROM filing_requirements r JOIN tax_filings f ON f.id = r.filing_id WHERE f.company_id = ? AND f.tax_period_key = '2026-10-payment'",
      )
      .all(CORP) as { code: string; auto_linked: number }[]
    expect(codes).toContainEqual({ code: 'payroll_ledger_closed', auto_linked: 1 })
    const other = ctx.db
      .prepare("SELECT COUNT(*) AS n FROM filing_requirements WHERE company_id = ? AND code = 'payroll_ledger_closed'")
      .get(SEED.companies.individual) as { n: number }
    expect(other.n).toBe(0)
  })
})

describe('estimated VAT', () => {
  it('sums included sources once per dedupe group and reports freshness', async () => {
    const ctx = await createTestContext()
    const response = await ctx.call(await ctx.token(USERS.admin, CORP), 'GET', `/api/company/${CORP}/reports/estimated-vat/?on=2026-11-01`)
    const body = (await response.json()) as Record<string, unknown> & { breakdown: { source: string; side: string; included_in_total: boolean }[] }
    expect(body).toMatchObject({
      period: { start: '2026-10-01', end: '2026-12-31', unit: 'quarter' },
      output_tax: 4_400_000,
      input_tax: 1_000_000,
      estimated_tax: 3_400_000,
      is_refund: false,
      card_split_estimated: true,
      excluded: { non_deductible_count: 1, unclassified_count: 1 },
    })
    expect(body.breakdown).toContainEqual(expect.objectContaining({ source: 'mall', side: 'sales', included_in_total: false }))
    expect(body.breakdown.find((entry) => entry.source === 'delivery')).toBeUndefined()
  })

  it('is available to free companies with permission', async () => {
    const ctx = await createTestContext()
    const free = SEED.companies.free
    const response = await ctx.call(await ctx.token(USERS.freeAdmin, free), 'GET', `/api/company/${free}/reports/estimated-vat`)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ estimated_tax: 0 })
  })

  it('prefers confirmed filings in the trend for taxation customers', async () => {
    const ctx = await createTestContext()
    ctx.db
      .prepare(
        `INSERT INTO tax_filings (id, company_id, tax_type, kind, tax_period_key, year, quarter, period_start, period_end, statutory_due, due_date,
           payment_due, status, payable_amount, created_at, updated_at)
         VALUES ('f-old', ?, 'surtax', 'final', '2025-2-final', 2025, 4, '2025-10-01', '2025-12-31', '2026-01-25', '2026-01-26', '2026-01-26', 'filed', 2500000, 't', 't')`,
      )
      .run(CORP)
    const response = await ctx.call(await ctx.token(USERS.admin, CORP), 'GET', `/api/company/${CORP}/reports/estimated-vat/trend?years=2`)
    const { results } = (await response.json()) as { results: { year: number; half: number; amount: number; source: string }[] }
    expect(results).toContainEqual({ year: 2025, half: 2, amount: 2_500_000, source: 'confirmed' })
    expect(results).toContainEqual({ year: 2026, half: 2, amount: 3_400_000, source: 'estimated' })
  })
})
