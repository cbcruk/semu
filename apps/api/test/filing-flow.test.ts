import { beforeEach, describe, expect, it } from 'vitest'
import { CORP, createTestContext, fileForm, pdfBytes, type TestContext, USERS } from './helpers/test-app'

interface FilingBody {
  id: string
  status: string
  version: number
  step: string | null
  [key: string]: unknown
}

const base = `/api/company/${CORP}`

describe('VAT filing lifecycle', () => {
  let ctx: TestContext
  let admin: string
  let agent: string
  let plain: string
  let filing: FilingBody

  const detail = async (): Promise<FilingBody & { requirements: { code: string; response: string }[]; documents: { id: string; doc_type: string }[]; timeline: unknown[] }> => {
    const response = await ctx.call(admin, 'GET', `${base}/tax/surtax/${filing.id}/`)
    expect(response.status).toBe(200)
    expect(response.headers.get('ETag')).toMatch(/^"\d+"$/)
    return response.json() as never
  }

  const desk = async (action: string, version: number, json?: unknown): Promise<Response> =>
    ctx.call(agent, 'POST', `/api/desk/filings/${filing.id}/${action}`, { ifMatch: version, ...(json === undefined ? {} : { json }) })

  beforeEach(async () => {
    ctx = await createTestContext()
    admin = await ctx.token(USERS.admin, CORP)
    agent = await ctx.token(USERS.agent)
    plain = await ctx.token(USERS.plainMember, CORP)
    const list = (await (await ctx.call(admin, 'GET', `${base}/tax/surtax/`)).json()) as { results: FilingBody[] }
    const final = list.results.find((item) => item['tax_period_key'] === '2026-2-final')
    if (final === undefined) throw new Error('2026-2-final not scheduled')
    filing = final
  })

  it('runs from scheduling to settlement with the legacy fields filled in', async () => {
    expect(filing).toMatchObject({ status: 'scheduled', due_date: '2027-01-25', payment_deadline: '2027-01-25', process_step: null })

    expect((await ctx.call(admin, 'POST', `${base}/tax/surtax/${filing.id}/submit`, { ifMatch: filing.version })).status).toBe(409)

    let response = await desk('request', filing.version, { submit_due: '2027-01-15' })
    expect(response.status).toBe(200)
    filing = (await response.json()) as FilingBody
    expect(filing).toMatchObject({ status: 'requested', process_step: '자료 제출 가능' })

    const active = (await (await ctx.call(admin, 'GET', `${base}/home/action-cards/active`)).json()) as { results: { kind: string; title: string; due_date: string }[] }
    expect(active.results).toContainEqual(expect.objectContaining({ kind: 'submit_materials', title: '2026년 4분기 부가세 자료 제출', due_date: '2027-01-15' }))
    const plainSummary = (await (await ctx.call(plain, 'GET', `${base}/home/action-cards/summary`)).json()) as { active_count: number }
    expect(plainSummary.active_count).toBe(0)

    response = await ctx.call(admin, 'POST', `${base}/tax/surtax/${filing.id}/requirements/simple_receipt/files/`, {
      form: fileForm(pdfBytes('receipts'), '간이영수증.pdf'),
    })
    expect(response.status).toBe(201)
    for (const code of ['pg_online_sales', 'export_fx', 'paper_tax_invoice', 'ending_inventory']) {
      const put = await ctx.call(admin, 'PUT', `${base}/tax/surtax/${filing.id}/requirements/${code}`, { json: { response: 'not_applicable' } })
      expect(put.status).toBe(200)
    }
    let current = await detail()
    expect((await ctx.call(admin, 'POST', `${base}/tax/surtax/${filing.id}/submit`, { ifMatch: current.version })).status).toBe(422)
    await ctx.call(admin, 'PUT', `${base}/tax/surtax/${filing.id}/requirements/deposit_fund_accounts`, { json: { response: 'not_applicable' } })
    current = await detail()

    expect((await ctx.call(admin, 'POST', `${base}/tax/surtax/${filing.id}/submit`)).status).toBe(428)
    expect((await ctx.call(admin, 'POST', `${base}/tax/surtax/${filing.id}/submit`, { ifMatch: current.version - 1 })).status).toBe(412)
    response = await ctx.call(admin, 'POST', `${base}/tax/surtax/${filing.id}/submit`, { ifMatch: current.version })
    expect(response.status).toBe(200)
    filing = (await response.json()) as FilingBody

    filing = (await (await desk('start-review', filing.version)).json()) as FilingBody
    expect(filing.status).toBe('reviewing')
    const late = await ctx.call(admin, 'POST', `${base}/tax/surtax/${filing.id}/requirements/simple_receipt/files`, {
      form: fileForm(pdfBytes('late'), 'late.pdf'),
    })
    expect(late.status).toBe(409)
    expect(ctx.storage.objects.size).toBe(1)

    response = await ctx.call(agent, 'POST', `/api/desk/filings/${filing.id}/ledger`, { ifMatch: filing.version, form: fileForm(pdfBytes('ledger v1'), '매입매출장.pdf') })
    expect(response.status).toBe(201)
    filing = (await response.json()) as FilingBody
    expect(filing).toMatchObject({ status: 'ledger_pending', process_step: '매입매출장 확인', purchase_sales_ledger_upload_completed: '2026-11-01' })
    expect((await detail()).documents.map((doc) => doc.doc_type)).toEqual(['ledger'])

    response = await ctx.call(admin, 'POST', `${base}/tax/surtax/${filing.id}/ledger/dispute`, { ifMatch: filing.version, json: { reason: '카드 매출 누락' } })
    filing = (await response.json()) as FilingBody
    expect(filing).toMatchObject({ status: 'reviewing', ledger_dispute_count: 1 })

    response = await ctx.call(agent, 'POST', `/api/desk/filings/${filing.id}/ledger`, { ifMatch: filing.version, form: fileForm(pdfBytes('ledger v2'), '매입매출장-수정.pdf') })
    filing = (await response.json()) as FilingBody
    response = await ctx.call(admin, 'POST', `${base}/tax/surtax/${filing.id}/ledger/confirm`, { ifMatch: filing.version })
    filing = (await response.json()) as FilingBody
    expect(filing).toMatchObject({ status: 'preparing', process_step: '부가세 작업중', purchase_sales_ledger_confirm_completed: '2026-11-01' })

    expect((await desk('file', filing.version, { payable_amount: 1_704_600 })).status).toBe(422)
    await ctx.call(agent, 'POST', `/api/desk/filings/${filing.id}/documents`, { form: fileForm(pdfBytes('return'), '신고서.pdf', { doc_type: 'return' }) })
    response = await ctx.call(agent, 'POST', `/api/desk/filings/${filing.id}/documents`, {
      form: fileForm(pdfBytes('slip'), '납부서.pdf', { doc_type: 'payment_slip' }),
    })
    filing = (await response.json()) as FilingBody
    response = await desk('file', filing.version, { payable_amount: 1_704_600 })
    expect(response.status).toBe(200)
    filing = (await response.json()) as FilingBody
    expect(filing).toMatchObject({ status: 'filed', amount: 1_704_600, payment_slip_sent: '2026-11-01', process_step: '부가세 납부' })

    const documents = (await detail()).documents
    expect(documents.map((doc) => doc.doc_type).sort()).toEqual(['ledger', 'payment_slip', 'return'])
    const returnDoc = documents.find((doc) => doc.doc_type === 'return')
    const download = await ctx.call(admin, 'GET', `${base}/tax/surtax/${filing.id}/documents/${returnDoc?.id}`)
    expect(download.status).toBe(200)
    expect(download.headers.get('Content-Disposition')).toContain("filename*=UTF-8''")
    expect(download.headers.get('X-Content-Type-Options')).toBe('nosniff')

    const cards = (await (await ctx.call(admin, 'GET', `${base}/home/action-cards/active`)).json()) as { results: { kind: string }[] }
    expect(cards.results.map((card) => card.kind)).toContain('pay_tax')
    expect(cards.results.map((card) => card.kind)).not.toContain('review_filing_result')

    expect((await desk('close', filing.version)).status).toBe(409)
    response = await ctx.call(admin, 'POST', `${base}/tax/surtax/${filing.id}/pay`, { ifMatch: filing.version, json: { paid_on: '2027-01-20' } })
    filing = (await response.json()) as FilingBody
    expect(filing).toMatchObject({ status: 'settled', settlement: 'paid', paid_on: '2027-01-20', process_step: '부가세 마감' })

    const archived = (await (await ctx.call(admin, 'GET', `${base}/home/action-cards/archived`)).json()) as { count: number }
    expect(archived.count).toBe(4)
    const timeline = (await detail()).timeline as { type: string }[]
    expect(timeline.filter((event) => event.type === 'disputeLedger')).toHaveLength(1)
  })

  it('lets only one of two concurrent transitions win', async () => {
    const requested = (await (await desk('request', filing.version, { submit_due: '2027-01-15' })).json()) as FilingBody
    const first = await desk('start-review', requested.version)
    const second = await desk('start-review', requested.version)
    expect([first.status, second.status].sort()).toEqual([200, 409])
  })

  it('records a skipped card after its deadline as overdue', async () => {
    await desk('request', filing.version, { submit_due: '2026-10-30' })
    const active = (await (await ctx.call(admin, 'GET', `${base}/home/action-cards/active`)).json()) as { results: { id: string; kind: string }[] }
    const card = active.results.find((item) => item.kind === 'submit_materials')
    const response = await ctx.call(admin, 'POST', `${base}/home/action-cards/${card?.id}/complete`, { json: { completion_reason: 'skip' } })
    expect(await response.json()).toMatchObject({ status: 'skipped_overdue' })
    const again = await ctx.call(admin, 'POST', `${base}/home/action-cards/${card?.id}/complete`, { json: { completion_reason: 'done' } })
    expect(again.status).toBe(409)
  })

  it('reopens the submission card when the agency rejects', async () => {
    let current = (await (await desk('request', filing.version, { submit_due: '2027-01-15' })).json()) as FilingBody
    current = (await (await desk('start-review', current.version)).json()) as FilingBody
    const response = await desk('reject', current.version, { reason: '재고 자료 누락', submit_due: '2027-01-18' })
    expect(await response.json()).toMatchObject({ status: 'requested', submit_due: '2027-01-18' })
    const active = (await (await ctx.call(admin, 'GET', `${base}/home/action-cards/active`)).json()) as { results: { kind: string; due_date: string }[] }
    expect(active.results).toContainEqual(expect.objectContaining({ kind: 'submit_materials', due_date: '2027-01-18' }))
    const row = ctx.db.prepare('SELECT reopen_count FROM action_cards WHERE source_id = ?').get(filing.id) as { reopen_count: number }
    expect(row.reopen_count).toBe(1)
  })

  it('shows the tracker with legacy step labels', async () => {
    await desk('request', filing.version, { submit_due: '2027-01-15' })
    const tracker = (await (await ctx.call(admin, 'GET', `${base}/home/tracker`)).json()) as { results: { filing_id: string; step: string; step_count: number }[] }
    expect(tracker.results).toContainEqual(expect.objectContaining({ filing_id: filing.id, step: '자료 제출 가능', step_count: 6 }))
  })
})
