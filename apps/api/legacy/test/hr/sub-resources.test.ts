import { describe, expect, it } from 'vitest'
import { fileForm } from '../helpers/test-app'
import { createEmployee, HR_BASE, hrSuite, json, seededId, versionOf, WAGE } from './hr-fixtures'

const PDF = new TextEncoder().encode('%PDF-1.4\n% employee document\n')

describe('employee sub-resources', () => {
  it('keeps effective-dated social insurance and deduction settings', async () => {
    const suite = await hrSuite()
    const id = (await createEmployee(suite)).id
    const path = `${WAGE}/${id}/social-insurance-info`
    await json(await suite.call(suite.admin, 'PUT', path, { json: { nps_enrolled: true, effective_date: '2026-01-01' } }), 200)
    const future = await json<{ nps_enrolled: boolean; effective_from: string }>(
      await suite.call(suite.admin, 'PUT', path, { json: { nps_enrolled: false, nps_exclusion_reason: '만 60세 이상', effective_date: '2027-01-01' } }),
      200,
    )
    expect(future).toMatchObject({ nps_enrolled: true, effective_from: '2026-01-01' })
    expect(suite.db.prepare('SELECT COUNT(*) AS n FROM employee_social_insurance_infos WHERE employee_id = ?').get(id)).toEqual({ n: 2 })

    const deduction = `${WAGE}/${id}/deduction-info`
    const saved = await json<{ income_tax_rate: number; effective_from: string }>(await suite.call(suite.admin, 'PUT', deduction, { json: { income_tax_rate: 80 } }), 200)
    expect(saved).toMatchObject({ income_tax_rate: 80, effective_from: '2026-11-01' })
    const youth = await suite.call(suite.admin, 'PUT', deduction, {
      json: {
        income_tax_reduction_type: 'small_biz',
        income_tax_reduction_reason: 'youth',
        income_tax_reduction_application_type: 'payroll',
        income_tax_reduction_start_date: '2026-03-01',
        income_tax_reduction_end_date: '2032-03-01',
      },
    })
    expect((await json<{ code: string }>(youth, 422)).code).toBe('VALIDATION_FAILED')
  })

  it('counts year-end dependants from family members', async () => {
    const suite = await hrSuite()
    const id = (await createEmployee(suite)).id
    const family = `${WAGE}/${id}/family-members`
    await json(
      await suite.call(suite.admin, 'POST', family, {
        json: { name: '정아이', birth_date: '2014-05-05', relation: '자녀', is_local: true, is_year_end_target: true, year_end_dependant_type: '20세_이하' },
      }),
      201,
    )
    await json(
      await suite.call(suite.admin, 'POST', family, { json: { name: '정부모', birth_date: '1960-02-02', relation: '부모', is_local: true, is_year_end_target: true, year_end_dependant_type: '60세_이상' } }),
      201,
    )
    const deduction = await json<{ dependents_count: number; children_8_to_20_count: number }>(await suite.call(suite.admin, 'GET', `${WAGE}/${id}/deduction-info`), 200)
    expect(deduction).toMatchObject({ dependents_count: 3, children_8_to_20_count: 1 })
    const filings = suite.db.prepare("SELECT kind FROM employee_insurance_filings WHERE employee_id = ? AND status = 'pending'").all(id) as { kind: string }[]
    expect(filings.map((row) => row.kind)).toContain('join')
  })

  it('requires If-Match for leaves and rejects overlapping periods', async () => {
    const suite = await hrSuite()
    const id = (await createEmployee(suite)).id
    const leaves = `${WAGE}/${id}/leave-of-absences`
    const body = { reason: 'illness', start_date: '2026-11-10', end_date: '2026-12-31' }
    expect((await json<{ code: string }>(await suite.call(suite.admin, 'POST', leaves, { json: body }), 428)).code).toBe('PRECONDITION_REQUIRED')

    const version = await versionOf(suite, id)
    await json(await suite.call(suite.admin, 'POST', leaves, { json: body, ifMatch: version }), 201)
    expect(await versionOf(suite, id)).toBe(version + 1)
    expect((await json<{ code: string }>(await suite.call(suite.admin, 'POST', leaves, { json: { ...body, start_date: '2027-03-01', end_date: '2027-03-31' }, ifMatch: version }), 412)).code).toBe('VERSION_CONFLICT')

    const overlap = await suite.call(suite.admin, 'POST', leaves, { json: { ...body, start_date: '2026-12-01', end_date: '2027-01-31' }, ifMatch: version + 1 })
    expect((await json<{ code: string }>(overlap, 400)).code).toBe('LEAVE_OVERLAP')

    const info = await json<{ is_on_leave: boolean; upcoming_leave: { start_date: string } | null }>(await suite.call(suite.admin, 'GET', `${WAGE}/${id}/leave-of-absence-info`), 200)
    expect(info.is_on_leave).toBe(false)
    expect(info.upcoming_leave?.start_date).toBe('2026-11-10')
  })

  it('records a resignation behind If-Match and keeps the leave date after the interim settlement', async () => {
    const suite = await hrSuite()
    const id = (await createEmployee(suite)).id
    const path = `${WAGE}/${id}/retirement-info`
    const body = { leave_date: '2026-10-31', leaving_reason: '11', leaving_detail_reason: '11-1' }
    expect((await suite.call(suite.admin, 'PUT', path, { json: body })).status).toBe(428)
    const version = await versionOf(suite, id)
    const early = await suite.call(suite.admin, 'PUT', path, {
      json: { ...body, has_interim_settlement: true, interim_settlement_date: '2026-11-15', interim_settlement_reason: 'home_purchase' },
      ifMatch: version,
    })
    expect((await json<{ code: string }>(early, 400)).code).toBe('LEAVE_DATE_BEFORE_INTERIM')
    await json(await suite.call(suite.admin, 'PUT', path, { json: body, ifMatch: version }), 200)
    expect((await json<{ status: string }>(await suite.call(suite.admin, 'GET', `${WAGE}/${id}`), 200)).status).toBe('RESIGNED')
  })

  it('uploads, downloads and deletes documents in the document box', async () => {
    const suite = await hrSuite()
    const id = seededId(suite, '김민준')
    const base = `${WAGE}/${id}/documents`
    const created = await json<{ id: number; category: { code: string }; size: number }>(
      await suite.call(suite.admin, 'POST', base, { form: fileForm(PDF, '서약서.pdf', { category: 'consent', source_type: 'upload' }) }),
      201,
    )
    expect(created.category.code).toBe('consent')
    expect((await suite.call(suite.admin, 'POST', base, { form: fileForm(new TextEncoder().encode('plain'), 'a.txt', { category: 'etc' }) })).status).toBe(415)

    const list = await json<{ count: number }>(await suite.call(suite.admin, 'GET', `${base}?category=3`), 200)
    expect(list.count).toBe(1)
    expect((await json<{ count: number }>(await suite.call(suite.admin, 'GET', `${base}?category=contract`), 200)).count).toBe(0)

    const download = await suite.call(suite.admin, 'GET', `${base}/${created.id}/download`)
    expect(download.status).toBe(200)
    expect(download.headers.get('Content-Disposition')).toContain(encodeURIComponent('서약서.pdf'))
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(PDF)

    await json(await suite.call(suite.admin, 'DELETE', `${base}/${created.id}`), 204)
    expect((await suite.call(suite.admin, 'GET', `${base}/${created.id}`)).status).toBe(404)
  })

  it('replaces departments in bulk but keeps ones that were assigned', async () => {
    const suite = await hrSuite()
    const current = await json<{ results: { id: number; name: string; is_used: boolean }[] }>(await suite.call(suite.admin, 'GET', `${HR_BASE}/departments`), 200)
    expect(current.results.map((row) => row.name)).toEqual(['경영지원팀', '개발팀', '디자인팀'])
    expect(current.results.every((row) => row.is_used)).toBe(true)

    const dropUsed = await suite.call(suite.admin, 'POST', `${HR_BASE}/departments/bulk`, { json: { items: current.results.slice(1) } })
    expect((await json<{ code: string }>(dropUsed, 400)).code).toBe('DEPARTMENT_IN_USE')

    const renamed = current.results.map((row, index) => ({ id: row.id, name: index === 0 ? '디자인팀' : index === 2 ? '경영지원팀' : row.name }))
    const saved = await json<{ results: { name: string }[] }>(await suite.call(suite.admin, 'POST', `${HR_BASE}/departments/bulk`, { json: [...renamed, { name: '영업팀' }] }), 200)
    expect(saved.results.map((row) => row.name)).toEqual(['디자인팀', '개발팀', '경영지원팀', '영업팀'])

    const unused = await json<{ results: { name: string }[] }>(await suite.call(suite.admin, 'POST', `${HR_BASE}/departments/bulk`, { json: renamed }), 200)
    expect(unused.results).toHaveLength(3)

    const positions = await json<{ count: number }>(await suite.call(suite.admin, 'GET', `${HR_BASE}/positions`), 200)
    expect(positions.count).toBe(4)
  })

  it('keeps a memo with its history', async () => {
    const suite = await hrSuite()
    const id = seededId(suite, '김민준')
    await json(await suite.call(suite.admin, 'PUT', `${WAGE}/${id}/memo`, { json: { content: '연봉 협상 예정' } }), 200)
    await json(await suite.call(suite.admin, 'DELETE', `${WAGE}/${id}/memo`), 204)
    const memo = await json<{ content: string }>(await suite.call(suite.admin, 'GET', `${WAGE}/${id}/memo`), 200)
    expect(memo.content).toBe('')
    const history = await json<{ count: number }>(await suite.call(suite.admin, 'GET', `${WAGE}/${id}/memo-histories`), 200)
    expect(history.count).toBe(2)
  })
})
