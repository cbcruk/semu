import { describe, expect, it } from 'vitest'
import { CORP, USERS } from '../helpers/test-app'
import { HR_BASE, hrSuite, json, seededId, WAGE } from './hr-fixtures'

describe('HR access', () => {
  it('requires a payroll plan for 구성원 정보', async () => {
    const suite = await hrSuite({ payrollPlan: false })
    const response = await suite.call(suite.admin, 'GET', WAGE)
    expect((await json<{ code: string }>(response, 403)).code).toBe('ENTITLEMENT_REQUIRED')
    expect((await suite.call(suite.admin, 'GET', `/api/company/${CORP}/employee`)).status).toBe(200)
  })

  it('denies members without the menu permission', async () => {
    const suite = await hrSuite()
    const taxMember = await suite.token(USERS.taxMember, CORP)
    expect((await suite.call(taxMember, 'GET', WAGE)).status).toBe(403)
    expect((await suite.call(taxMember, 'GET', `${HR_BASE}/departments`)).status).toBe(403)
  })

  it('keeps demo accounts read-only', async () => {
    const suite = await hrSuite()
    const demo = await suite.token(USERS.demo, CORP)
    expect((await suite.call(demo, 'GET', WAGE)).status).toBe(200)
    const id = seededId(suite, '김민준')
    expect((await suite.call(demo, 'GET', `${WAGE}/${id}`)).status).toBe(200)
    expect((await suite.call(demo, 'PATCH', `${WAGE}/${id}`, { json: { name: '변경' } })).status).toBe(403)
    expect((await suite.call(demo, 'POST', `${HR_BASE}/departments/bulk`, { json: [] })).status).toBe(403)
  })

  it('hides other companies employees', async () => {
    const suite = await hrSuite()
    const id = seededId(suite, '김민준')
    const other = await suite.token(USERS.individualAdmin, 'c-ind')
    expect((await suite.call(other, 'GET', `/api/company/c-ind/employment/wage-employees/${id}`)).status).not.toBe(200)
  })

  it('serves the 서식 모음 catalog to any signed-in user', async () => {
    const suite = await hrSuite()
    expect((await suite.anonymous('GET', '/nexus-api/document-form')).status).toBe(401)
    const free = await suite.token(USERS.freeAdmin, 'c-free')
    const all = await json<{ count: number; results: { title: string; type: string; file_url: null }[] }>(await suite.call(free, 'GET', '/nexus-api/document-form?limit=100'), 200)
    expect(all.count).toBe(39)
    const hr = await json<{ count: number }>(await suite.call(free, 'GET', `/nexus-api/document-form?type=${encodeURIComponent('인사')}`), 200)
    expect(hr.count).toBe(17)
    const counts = await json<{ type: string; count: number }[]>(await suite.call(free, 'GET', '/nexus-api/document-form/type-count'), 200)
    expect(counts.reduce((total, row) => total + row.count, 0)).toBe(39)
    const search = await json<{ results: { title: string }[] }>(await suite.call(free, 'GET', `/nexus-api/document-form?search=${encodeURIComponent('차용증')}`), 200)
    expect(search.results.map((row) => row.title)).toEqual(['차용증'])
  })
})
