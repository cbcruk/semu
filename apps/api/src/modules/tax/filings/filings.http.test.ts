import { afterEach, describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { filingRecord } from '../tax-demo.ts'
import { taxTestApp } from '../tax-http.testing.ts'
import type { TaxTestApp } from '../tax-http.testing.ts'
import type { TaxEvent } from '../tax.public.ts'
import type { FilingRecord } from './filing.types.ts'

const VAT_ID = 'fil_01JBQ000000000000000000V01' as Id<'filing'>
const WHT_ID = 'fil_01JBQ000000000000000000W01' as Id<'filing'>
const FILE_ID = 'fle_01JBQ000000000000000000001'
const SLIP_ID = 'fle_01JBQ000000000000000000002'

function vat(overrides: Partial<FilingRecord> = {}): FilingRecord {
  return filingRecord({
    id: VAT_ID,
    taxType: 'VAT',
    kind: 'FINAL',
    periodKey: '2026-H2',
    periodStart: '2026-07-01',
    periodEnd: '2026-12-31',
    dueDate: '2027-01-25',
    paymentDue: '2027-01-25',
    status: 'REQUESTED',
    ...overrides,
  })
}

function withholding(overrides: Partial<FilingRecord> = {}): FilingRecord {
  return filingRecord({
    id: WHT_ID,
    taxType: 'WITHHOLDING_TAX',
    kind: 'MONTHLY',
    periodKey: '2026-10',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    dueDate: '2026-11-10',
    paymentDue: '2026-11-10',
    status: 'SETTLED',
    ...overrides,
  })
}

let app: TaxTestApp
afterEach(() => app.dispose())

describe('GET /v1/filings', () => {
  it('lists the newest period first and filters open filings', async () => {
    app = taxTestApp({ filings: [vat(), withholding()] })

    const all = await app.send('/filings')
    const open = await app.send('/filings?open=true')

    expect(all.status).toBe(200)
    expect((await all.json()).items.map((item: { id: string }) => item.id)).toEqual([VAT_ID, WHT_ID])
    expect((await open.json()).items).toMatchObject([
      { id: VAT_ID, progress: { stage: 'MATERIALS_OPEN', index: 1, count: 6 } },
    ])
  })

  it('asks for the taxation plan before anything else', async () => {
    app = taxTestApp({ filings: [vat()] })

    const response = await app.send('/filings', { token: 'free' })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'ENTITLEMENT_REQUIRED' })
  })
})

describe('GET /v1/filings/{filingId}', () => {
  it('returns the commands the viewer can send and an ETag', async () => {
    app = taxTestApp({ filings: [vat()] })

    const client = await app.send(`/filings/${VAT_ID}`)
    const agency = await app.send(`/filings/${VAT_ID}`, { token: 'agency' })

    expect(client.headers.get('etag')).toBe('"1"')
    expect((await client.json()).allowedActions).toEqual(['SUBMIT'])
    expect((await agency.json()).allowedActions).toEqual(['START_REVIEW', 'CANCEL'])
  })

  it('treats an unknown filing as not found', async () => {
    app = taxTestApp()

    const response = await app.send(`/filings/${VAT_ID}`)

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: 'FILING_NOT_FOUND' })
  })
})

describe('POST /v1/filings/{filingId}:submit', () => {
  it('refuses while client items are pending and names them', async () => {
    app = taxTestApp({ filings: [vat()] })

    const response = await app.send(`/filings/${VAT_ID}:submit`, { method: 'POST' })

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({
      code: 'FILING_REQUIREMENTS_PENDING',
      requirementCodes: expect.arrayContaining(['PG_ONLINE_SALES', 'DEPOSIT_FUND_ACCOUNTS']),
    })
  })

  it('submits once every item is answered and publishes the status change', async () => {
    const events: TaxEvent[] = []
    app = taxTestApp({ filings: [vat()], events })
    const codes = vat().requirements.map((requirement) => requirement.code)

    for (const code of codes.slice(1)) {
      const answered = await app.send(`/filings/${VAT_ID}/requirements/${code}`, {
        method: 'PATCH',
        body: { response: 'NOT_APPLICABLE' },
      })
      expect(answered.status).toBe(200)
    }
    const attached = await app.send(`/filings/${VAT_ID}/requirements/${codes[0]}/files`, { body: { fileId: FILE_ID } })
    const submitted = await app.send(`/filings/${VAT_ID}:submit`, { method: 'POST', ifMatch: `"${codes.length + 1}"` })

    expect((await attached.json()).requirements[0]).toMatchObject({ response: 'PROVIDED', fileIds: [FILE_ID] })
    expect(submitted.status).toBe(200)
    expect(await submitted.json()).toMatchObject({ status: 'SUBMITTED', allowedActions: ['UNSUBMIT'] })
    expect(events).toMatchObject([
      { type: 'filing.status_changed', filingId: VAT_ID, fromStatus: 'REQUESTED', toStatus: 'SUBMITTED' },
    ])
  })

  it('belongs to the client', async () => {
    app = taxTestApp({ filings: [vat({ requirements: [] })] })

    const response = await app.send(`/filings/${VAT_ID}:submit`, { method: 'POST', token: 'agency' })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      code: 'FILING_ACTOR_NOT_ALLOWED',
      action: 'SUBMIT',
      requiredActorKind: 'CLIENT',
    })
  })

  it('rejects a stale If-Match', async () => {
    app = taxTestApp({ filings: [vat({ requirements: [] })] })

    const response = await app.send(`/filings/${VAT_ID}:submit`, { method: 'POST', ifMatch: '"7"' })

    expect(response.status).toBe(412)
    expect(await response.json()).toMatchObject({ code: 'VERSION_MISMATCH', currentVersion: 1 })
  })
})

describe('VAT filing flow', () => {
  it('runs review, ledger confirmation, filing and payment with the action cards in step', async () => {
    app = taxTestApp({ filings: [vat({ status: 'SUBMITTED', requirements: [] })] })
    const agency = { token: 'agency' as const }

    expect((await app.send(`/filings/${VAT_ID}:start-review`, { ...agency, method: 'POST' })).status).toBe(200)
    const uploaded = await app.send(`/filings/${VAT_ID}:upload-ledger`, { ...agency, body: { ledgerFileId: FILE_ID } })
    expect(await uploaded.json()).toMatchObject({ status: 'LEDGER_PENDING', documents: [{ type: 'LEDGER' }] })

    const cards = await (await app.send('/action-cards')).json()
    expect(cards.items).toMatchObject([{ kind: 'CONFIRM_LEDGER', status: 'OPEN', subject: { filingId: VAT_ID } }])

    const confirmed = await app.send(`/filings/${VAT_ID}:confirm-ledger`, { method: 'POST' })
    expect(await confirmed.json()).toMatchObject({ status: 'PREPARING' })

    const filed = await app.send(`/filings/${VAT_ID}:file`, {
      ...agency,
      body: { payableAmount: 120_000, returnFileId: FILE_ID, paymentSlipFileId: SLIP_ID },
    })
    const filedBody = await filed.json()
    expect(filedBody).toMatchObject({ status: 'FILED', payableAmount: 120_000, paymentDue: '2027-01-25' })
    expect(filedBody.paymentSlipSentAt).not.toBeNull()

    const clientView = await (await app.send(`/filings/${VAT_ID}`)).json()
    const returnDocument = clientView.documents.find((document: { type: string }) => document.type === 'RETURN')
    expect(clientView.documents.map((document: { type: string }) => document.type).sort()).toEqual([
      'LEDGER',
      'PAYMENT_SLIP',
      'RETURN',
    ])

    const opened = await app.send(`/filings/${VAT_ID}/documents/${returnDocument.id}`)
    expect((await opened.json()).firstViewedAt).not.toBeNull()
    const openKinds = (await (await app.send('/action-cards')).json()).items.map((card: { kind: string }) => card.kind)
    expect(openKinds).toEqual(['PAY_TAX'])

    const paid = await app.send(`/filings/${VAT_ID}:pay`, { body: { paidOn: '2027-01-20' } })
    expect(await paid.json()).toMatchObject({
      status: 'SETTLED',
      settlement: 'PAID',
      paidOn: '2027-01-20',
      allowedActions: [],
    })
    expect(await (await app.send('/action-cards:summary')).json()).toMatchObject({ openCount: 0, closedCount: 3 })
  })

  it('closes a refund filing without payment', async () => {
    app = taxTestApp({ filings: [vat({ status: 'FILED', payableAmount: -50_000 })] })

    const pay = await app.send(`/filings/${VAT_ID}:pay`, { body: { paidOn: '2027-01-20' } })
    const close = await app.send(`/filings/${VAT_ID}:close`, { method: 'POST', token: 'agency' })

    expect(pay.status).toBe(409)
    expect(await pay.json()).toMatchObject({
      code: 'FILING_TRANSITION_INVALID',
      currentStatus: 'FILED',
      command: 'PAY',
    })
    expect(await close.json()).toMatchObject({ status: 'SETTLED', settlement: 'REFUND' })
  })

  it('hides agency documents from the client until the filing is filed', async () => {
    app = taxTestApp({ filings: [vat({ status: 'PREPARING', requirements: [] })] })

    const added = await app.send(`/filings/${VAT_ID}/documents`, {
      token: 'agency',
      body: { type: 'RETURN', fileId: FILE_ID },
    })
    const documentId = (await added.json()).documents[0].id
    const client = await app.send(`/filings/${VAT_ID}/documents/${documentId}`)
    const byClient = await app.send(`/filings/${VAT_ID}/documents`, { body: { type: 'RETURN', fileId: FILE_ID } })

    expect(added.status).toBe(200)
    expect(client.status).toBe(404)
    expect(byClient.status).toBe(403)
    expect(await byClient.json()).toMatchObject({ code: 'FILING_ACTOR_NOT_ALLOWED', action: 'ADD_DOCUMENT' })
  })
})

describe('withholding commands sent by agency staff for the client (2026-11-07)', () => {
  const clientItems = () =>
    withholding()
      .requirements.filter((requirement) => !requirement.autoLinked)
      .map((requirement) => requirement.code)

  it('lets assigned agency staff answer, submit and unsubmit, and records the agency acting for the client', async () => {
    const events: TaxEvent[] = []
    app = taxTestApp({ filings: [withholding({ status: 'REQUESTED' })], events })

    for (const code of clientItems()) {
      const answered = await app.send(`/filings/${WHT_ID}/requirements/${code}`, {
        method: 'PATCH',
        token: 'agency',
        body: { response: 'NOT_APPLICABLE' },
      })
      expect(answered.status).toBe(200)
    }
    const version = clientItems().length + 1
    const submitted = await app.send(`/filings/${WHT_ID}:submit`, {
      method: 'POST',
      token: 'agency',
      ifMatch: `"${version}"`,
    })
    expect(submitted.status).toBe(200)
    expect(await submitted.json()).toMatchObject({ status: 'SUBMITTED', allowedActions: ['START_REVIEW', 'CANCEL'] })
    expect((await (await app.send(`/filings/${WHT_ID}`)).json()).allowedActions).toEqual(['UNSUBMIT'])

    const unsubmitted = await app.send(`/filings/${WHT_ID}:unsubmit`, { method: 'POST', token: 'agency' })
    expect(unsubmitted.status).toBe(200)
    expect(await unsubmitted.json()).toMatchObject({ status: 'REQUESTED' })

    const { items } = await (await app.send(`/filings/${WHT_ID}/history`)).json()
    expect(items[0]).toMatchObject({ type: 'REQUIREMENT_ANSWERED', actorKind: 'AGENCY', onBehalfOf: 'CLIENT' })
    expect(items.slice(-2)).toEqual([
      expect.objectContaining({
        type: 'SUBMIT',
        actorKind: 'AGENCY',
        onBehalfOf: 'CLIENT',
        fromStatus: 'REQUESTED',
        toStatus: 'SUBMITTED',
      }),
      expect.objectContaining({ type: 'UNSUBMIT', actorKind: 'AGENCY', onBehalfOf: 'CLIENT' }),
    ])
    expect(events).toMatchObject([
      { type: 'filing.status_changed', fromStatus: 'REQUESTED', toStatus: 'SUBMITTED' },
      { type: 'filing.status_changed', fromStatus: 'SUBMITTED', toStatus: 'REQUESTED' },
    ])
  })

  it('lets assigned agency staff record the payment of a filed return', async () => {
    app = taxTestApp({ filings: [withholding({ status: 'FILED', payableAmount: 120_000 })] })

    const agencyView = await (await app.send(`/filings/${WHT_ID}`, { token: 'agency' })).json()
    const paid = await app.send(`/filings/${WHT_ID}:pay`, {
      method: 'POST',
      token: 'agency',
      body: { paidOn: '2026-11-10' },
    })

    expect(agencyView.allowedActions).toEqual([])
    expect(paid.status).toBe(200)
    expect(await paid.json()).toMatchObject({ status: 'SETTLED', settlement: 'PAID', paidOn: '2026-11-10' })
    const { items } = await (await app.send(`/filings/${WHT_ID}/history`)).json()
    expect(items.at(-1)).toMatchObject({
      type: 'PAY',
      actorKind: 'AGENCY',
      onBehalfOf: 'CLIENT',
      detail: { paidOn: '2026-11-10' },
    })
  })

  it('refuses agency staff who are not assigned to the company', async () => {
    app = taxTestApp({ filings: [withholding({ status: 'REQUESTED', requirements: [] })] })

    const submit = await app.send(`/filings/${WHT_ID}:submit`, { method: 'POST', token: 'otherAgency' })
    const answer = await app.send(`/filings/${WHT_ID}/requirements/BUSINESS_INCOME`, {
      method: 'PATCH',
      token: 'otherAgency',
      body: { response: 'NOT_APPLICABLE' },
    })

    expect(submit.status).toBe(404)
    expect(await submit.json()).toMatchObject({ code: 'FILING_NOT_FOUND' })
    expect(answer.status).toBe(404)
    expect((await (await app.send(`/filings/${WHT_ID}`)).json()).status).toBe('REQUESTED')
  })

  it('keeps the commands of other tax types and the agency-only rules as they were', async () => {
    app = taxTestApp({ filings: [vat({ status: 'FILED', payableAmount: 482_000 })] })

    const pay = await app.send(`/filings/${VAT_ID}:pay`, {
      method: 'POST',
      token: 'agency',
      body: { paidOn: '2026-11-10' },
    })

    expect(pay.status).toBe(403)
    expect(await pay.json()).toMatchObject({
      code: 'FILING_ACTOR_NOT_ALLOWED',
      action: 'PAY',
      requiredActorKind: 'CLIENT',
    })
  })

  it('records the client without the marker when the client acts', async () => {
    app = taxTestApp({ filings: [withholding({ status: 'FILED', payableAmount: 120_000 })] })

    const paid = await app.send(`/filings/${WHT_ID}:pay`, { method: 'POST', body: { paidOn: '2026-11-10' } })

    expect(paid.status).toBe(200)
    const { items } = await (await app.send(`/filings/${WHT_ID}/history`)).json()
    expect(items.at(-1)).toMatchObject({ type: 'PAY', actorKind: 'CLIENT' })
    expect(items.at(-1)).not.toHaveProperty('onBehalfOf')
  })
})

describe('agent commands called by a client (D5)', () => {
  const startReview = (token: 'client' | 'viewer' | 'pendingTerms' | 'demo' | 'free') =>
    app.send(`/filings/${VAT_ID}:start-review`, { method: 'POST', token })

  it('answers FILING_ACTOR_NOT_ALLOWED to a client who can see filings', async () => {
    app = taxTestApp({ filings: [vat({ status: 'SUBMITTED' })] })

    for (const token of ['client', 'viewer'] as const) {
      const response = await startReview(token)
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({
        code: 'FILING_ACTOR_NOT_ALLOWED',
        action: 'START_REVIEW',
        requiredActorKind: 'AGENCY',
      })
    }
  })

  it('still asks for terms re-agreement first', async () => {
    app = taxTestApp({ filings: [vat({ status: 'SUBMITTED' })] })

    const response = await startReview('pendingTerms')

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'TERMS_REAGREEMENT_REQUIRED', termCodes: ['TAX_SERVICE'] })
  })

  it('still refuses a demo write as PERMISSION_DENIED', async () => {
    app = taxTestApp({ filings: [vat({ status: 'SUBMITTED' })] })

    const response = await startReview('demo')

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'PERMISSION_DENIED', permission: 'filing:process' })
  })

  it('still asks for the plan before anything else', async () => {
    app = taxTestApp({ filings: [vat({ status: 'SUBMITTED' })] })

    const response = await startReview('free')

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'ENTITLEMENT_REQUIRED' })
  })

  it('applies the same order to attaching a document', async () => {
    app = taxTestApp({ filings: [vat({ status: 'PREPARING', requirements: [] })] })
    const attach = (token: 'pendingTerms' | 'demo') =>
      app.send(`/filings/${VAT_ID}/documents`, { token, body: { type: 'RETURN', fileId: FILE_ID } })

    expect(await (await attach('pendingTerms')).json()).toMatchObject({ code: 'TERMS_REAGREEMENT_REQUIRED' })
    expect(await (await attach('demo')).json()).toMatchObject({ code: 'PERMISSION_DENIED' })
  })
})

describe('requirements', () => {
  it('are locked outside REQUESTED', async () => {
    app = taxTestApp({ filings: [vat({ status: 'SUBMITTED' })] })

    const response = await app.send(`/filings/${VAT_ID}/requirements/EXPORT_FX`, {
      method: 'PATCH',
      body: { response: 'NOT_APPLICABLE' },
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'FILING_LOCKED', currentStatus: 'SUBMITTED' })
  })

  it('keep the auto-linked payroll item out of client hands', async () => {
    app = taxTestApp({ filings: [withholding({ status: 'REQUESTED' })] })

    const response = await app.send(`/filings/${WHT_ID}/requirements/PAYROLL_LEDGER_CLOSED`, {
      method: 'PATCH',
      body: { response: 'NOT_APPLICABLE' },
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'REQUIREMENT_AUTO_LINKED' })
  })

  it('refuse NOT_APPLICABLE while files are attached', async () => {
    app = taxTestApp({ filings: [vat()] })

    await app.send(`/filings/${VAT_ID}/requirements/EXPORT_FX/files`, { body: { fileId: FILE_ID } })
    const response = await app.send(`/filings/${VAT_ID}/requirements/EXPORT_FX`, {
      method: 'PATCH',
      body: { response: 'NOT_APPLICABLE' },
    })
    const detached = await app.send(`/filings/${VAT_ID}/requirements/EXPORT_FX/files/${FILE_ID}`, { method: 'DELETE' })

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: 'REQUIREMENT_HAS_FILES' })
    expect((await detached.json()).requirements[1]).toMatchObject({
      code: 'EXPORT_FX',
      response: 'PENDING',
      fileIds: [],
    })
  })
})

describe('validation', () => {
  it('rejects a fractional tax amount', async () => {
    app = taxTestApp({ filings: [vat({ status: 'PREPARING' })] })

    const response = await app.send(`/filings/${VAT_ID}:file`, {
      token: 'agency',
      body: { payableAmount: 1.5, returnFileId: FILE_ID },
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'VALIDATION_FAILED' })
  })
})
