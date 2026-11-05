import { afterEach, describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { TEST_COMPANY_ID } from '../../identity-access/testing.ts'
import { taxTestApp } from '../tax-http.testing.ts'
import type { TaxTestApp } from '../tax-http.testing.ts'
import type { ActionCardRecord } from './action-card.ts'

function card(id: string, overrides: Partial<ActionCardRecord> = {}): ActionCardRecord {
  return {
    id: `acd_01JBQ00000000000000000000${id}` as Id<'actionCard'>,
    companyId: TEST_COMPANY_ID,
    kind: 'SUBMIT_MATERIALS',
    status: 'OPEN',
    subject: {
      type: 'FILING',
      filingId: 'fil_01JBQ000000000000000000V01' as Id<'filing'>,
      taxType: 'VAT',
      filingKind: 'FINAL',
      periodKey: '2026-H2',
    },
    requires: { permission: 'filing:read', plans: ['TAXATION'] },
    dueDate: '2027-01-10',
    reopenCount: 0,
    createdAt: '2026-11-01T00:00:00.000Z',
    completedAt: null,
    ...overrides,
  }
}

let app: TaxTestApp
afterEach(() => app.dispose())

describe('GET /v1/action-cards', () => {
  it('lists open cards by due date and hides the internal fields', async () => {
    app = taxTestApp({
      actionCards: [card('1'), card('2', { kind: 'PAY_TAX', dueDate: '2026-11-10' }), card('3', { status: 'DONE' })],
    })

    const response = await app.send('/action-cards')
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.items.map((item: { kind: string }) => item.kind)).toEqual(['PAY_TAX', 'SUBMIT_MATERIALS'])
    expect(body.items[0]).not.toHaveProperty('requires')
    expect(body.items[0]).not.toHaveProperty('companyId')
  })

  it('shows the closed tab', async () => {
    app = taxTestApp({
      actionCards: [card('1'), card('3', { status: 'DONE', completedAt: '2026-11-02T00:00:00.000Z' })],
    })

    const body = await (await app.send('/action-cards?status=CLOSED')).json()

    expect(body.items).toMatchObject([{ status: 'DONE' }])
  })

  it('hides cards of a plan the company does not have', async () => {
    app = taxTestApp({ actionCards: [card('1')] })

    const list = await (await app.send('/action-cards', { token: 'free' })).json()
    const summary = await (await app.send('/action-cards:summary', { token: 'free' })).json()

    expect(list.items).toEqual([])
    expect(summary).toEqual({ openCount: 0, closedCount: 0, nearestDueDate: null })
  })
})

describe('GET /v1/action-cards:summary', () => {
  it('counts both tabs and gives the nearest due date', async () => {
    app = taxTestApp({
      actionCards: [card('1'), card('2', { dueDate: '2026-11-10' }), card('3', { status: 'SKIPPED_OVERDUE' })],
    })

    const response = await app.send('/action-cards:summary')

    expect(await response.json()).toEqual({ openCount: 2, closedCount: 1, nearestDueDate: '2026-11-10' })
  })
})

describe('POST /v1/action-cards/{cardId}:complete', () => {
  it('marks an overdue skip as SKIPPED_OVERDUE', async () => {
    app = taxTestApp({ actionCards: [card('1', { dueDate: '2000-01-01' })] })

    const response = await app.send(`/action-cards/${card('1').id}:complete`, { body: { completion: 'SKIP' } })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: 'SKIPPED_OVERDUE' })
  })

  it('refuses a closed card', async () => {
    app = taxTestApp({ actionCards: [card('1', { status: 'DONE' })] })

    const response = await app.send(`/action-cards/${card('1').id}:complete`, { body: { completion: 'DONE' } })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'ACTION_CARD_CLOSED', currentStatus: 'DONE' })
  })

  it('needs the complete permission', async () => {
    app = taxTestApp({ actionCards: [card('1')] })

    const response = await app.send(`/action-cards/${card('1').id}:complete`, {
      token: 'viewer',
      body: { completion: 'DONE' },
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'PERMISSION_DENIED', permission: 'action-card:complete' })
  })
})
