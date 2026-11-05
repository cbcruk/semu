import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startTestApp, type TestApp } from '../shared/http-test-support.ts'

let app: TestApp

beforeEach(() => {
  app = startTestApp()
})

afterEach(async () => {
  await app.dispose()
})

describe('departments', () => {
  it('creates, renames and lists in order', async () => {
    const first = await app.json('POST', '/departments', { body: { name: '개발팀' } })
    const second = await app.json('POST', '/departments', { body: { name: '경영지원팀' } })

    expect(first.status).toBe(201)
    expect(second.body).toMatchObject({ name: '경영지원팀', order: 1, inUse: false })

    const renamed = await app.request('PATCH', `/departments/${first.body.id}`, {
      body: { name: '플랫폼팀' },
      ifMatch: '"1"',
    })
    expect(renamed.status).toBe(200)
    expect(renamed.headers.get('etag')).toBe('"2"')

    const list = await app.json('GET', '/departments')
    expect(list.body.items.map((unit: { name: string }) => unit.name)).toEqual(['플랫폼팀', '경영지원팀'])
  })

  it('rejects a duplicate name after trimming', async () => {
    await app.json('POST', '/departments', { body: { name: '개발팀' } })
    const duplicate = await app.json('POST', '/departments', { body: { name: ' 개발팀 ' } })

    expect(duplicate.status).toBe(409)
    expect(duplicate.body).toMatchObject({ code: 'ORGANIZATION_NAME_TAKEN' })
  })

  it('reorders with every id once', async () => {
    const a = await app.json('POST', '/positions', { body: { name: '사원' } })
    const b = await app.json('POST', '/positions', { body: { name: '대리' } })

    const reordered = await app.json('POST', '/positions:reorder', { body: { ids: [b.body.id, a.body.id] } })
    expect(reordered.body.items.map((unit: { name: string }) => unit.name)).toEqual(['대리', '사원'])

    const partial = await app.json('POST', '/positions:reorder', { body: { ids: [b.body.id] } })
    expect(partial.status).toBe(422)
  })

  it('needs a plan', async () => {
    const response = await app.json('GET', '/departments', { token: 'no-plan' })

    expect(response.status).toBe(403)
    expect(response.body).toMatchObject({ code: 'ENTITLEMENT_REQUIRED' })
  })
})
