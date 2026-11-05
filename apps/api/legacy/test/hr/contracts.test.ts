import { describe, expect, it } from 'vitest'
import { createEmployee, hrSuite, json, seededId, WAGE } from './hr-fixtures'

interface Alert {
  is_target: boolean
  status: string
  is_exempt: boolean
  conversion_date: string | null
}

describe('contracts', () => {
  it('flags chained fixed-term contracts reaching two years', async () => {
    const suite = await hrSuite()
    const id = (await createEmployee(suite, { join_date: '2025-01-02' })).id
    const work = `${WAGE}/${id}/work-contracts`
    await json(await suite.call(suite.admin, 'POST', work, { json: { contract_type: 'contract', start_date: '2025-01-02', end_date: '2025-12-31', weekly_work_hours: 40 } }), 201)
    const none = await json<Alert>(await suite.call(suite.admin, 'GET', `${work}/indefinite-conversion-alert`), 200)
    expect(none).toMatchObject({ is_target: false, status: 'none', conversion_date: '2027-01-02' })

    await json(await suite.call(suite.admin, 'POST', work, { json: { contract_type: 'contract', start_date: '2026-01-01', end_date: '2026-12-31', weekly_work_hours: 40 } }), 201)
    const approaching = await json<Alert>(await suite.call(suite.admin, 'GET', `${work}/indefinite-conversion-alert`), 200)
    expect(approaching).toMatchObject({ is_target: true, status: 'approaching' })

    await json(await suite.call(suite.admin, 'POST', work, { json: { contract_type: 'contract', start_date: '2027-01-01', end_date: '2027-06-30', weekly_work_hours: 40 } }), 201)
    expect((await json<Alert>(await suite.call(suite.admin, 'GET', `${work}/indefinite-conversion-alert`), 200)).status).toBe('exceeded')
    const detail = await json<{ warnings: string[] }>(await suite.call(suite.admin, 'GET', `${WAGE}/${id}`), 200)
    expect(detail.warnings).toContain('indefinite_conversion_target')
  })

  it('exempts employees aged 55 or over when the chain starts', async () => {
    const suite = await hrSuite()
    const id = (await createEmployee(suite, { registration_number: '640101-1000002', join_date: '2025-01-02' })).id
    const work = `${WAGE}/${id}/work-contracts`
    await json(await suite.call(suite.admin, 'POST', work, { json: { contract_type: 'contract', start_date: '2025-01-02', end_date: '2027-06-30', weekly_work_hours: 40 } }), 201)
    expect(await json<Alert>(await suite.call(suite.admin, 'GET', `${work}/indefinite-conversion-alert`), 200)).toMatchObject({ is_target: false, is_exempt: true, status: 'exceeded' })
  })

  it('validates contract periods and computes wages with the minimum wage verdict', async () => {
    const suite = await hrSuite()
    const id = seededId(suite, '김민준')
    const missingEnd = await suite.call(suite.admin, 'POST', `${WAGE}/${id}/work-contracts`, { json: { contract_type: 'contract', start_date: '2026-01-01' } })
    expect((await json<{ code: string }>(missingEnd, 422)).code).toBe('VALIDATION_FAILED')

    const payroll = `${WAGE}/${id}/payroll-contracts`
    const contract = await json<Record<string, unknown>>(
      await suite.call(suite.admin, 'POST', payroll, {
        json: { start_date: '2027-01-01', wage_type: 'monthly', amount: 2_000_000, pay_method: 'direct' },
      }),
      201,
    )
    expect(JSON.stringify(contract)).toContain('minimum')
    const list = await json<{ count: number; results: { account_number: string | null }[] }>(await suite.call(suite.admin, 'GET', payroll), 200)
    expect(list.count).toBe(2)
    expect(list.results.some((row) => row.account_number !== null && row.account_number.startsWith('****'))).toBe(true)
  })
})

describe('social insurance', () => {
  it('redetermines enrollment from age and working hours', async () => {
    const suite = await hrSuite()
    const id = (await createEmployee(suite, { registration_number: '600101-1000003', join_date: '2026-10-01' })).id
    const path = `${WAGE}/${id}/social-insurance-info`
    const stored = await json<{ nps_enrolled: boolean; recommended: { nps_enrolled: boolean; nps_exclusion_reason: string | null } }>(
      await suite.call(suite.admin, 'GET', path),
      200,
    )
    expect(stored.nps_enrolled).toBe(true)
    expect(stored.recommended).toMatchObject({ nps_enrolled: false, nps_exclusion_reason: '만 60세 이상' })

    const redetermined = await json<{ nps_enrolled: boolean; changed_fields: string[]; is_saved: boolean }>(await suite.call(suite.admin, 'GET', `${path}/redetermine`), 200)
    expect(redetermined.nps_enrolled).toBe(false)
    expect([...redetermined.changed_fields].sort()).toEqual(['ei_enrolled', 'ei_exclusion_reason', 'nps_enrolled', 'nps_exclusion_reason'])
    expect(redetermined.is_saved).toBe(false)

    const preview = await json<{ recommended: Record<string, unknown> }>(await suite.call(suite.admin, 'POST', `${path}/preview`, { json: { weekly_work_hours: 10 } }), 200)
    expect(preview.recommended).toMatchObject({ nhis_enrolled: false, ei_enrolled: false })

    await json(await suite.call(suite.admin, 'PUT', path, { json: stored.recommended }), 200)
    const again = await json<{ changed_fields: string[]; is_saved: boolean }>(await suite.call(suite.admin, 'GET', `${path}/redetermine`), 200)
    expect(again).toMatchObject({ changed_fields: [], is_saved: true })
  })
})
