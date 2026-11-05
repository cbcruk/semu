import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEMO_COMPANY_IDS, makeHarness, PUBLIC_BASE_URL } from './legacy-client.ts'
import type { Harness, LegacyClient } from './legacy-client.ts'

const CORPORATION = `/api/company/${DEMO_COMPANY_IDS.corporation}/employment/wage-employees`
const FREE = `/api/company/${DEMO_COMPANY_IDS.free}/employment/wage-employees`
const KIM = 'emp_01JBQ00000000000000000D3M1'
const FREELANCER = 'emp_01JBQ00000000000000000D3M2'

let harness: Harness
let client: LegacyClient

beforeEach(async () => {
  harness = makeHarness()
  client = harness.client()
  await client.login('owner@semu.example')
})

afterEach(() => harness.dispose())

/** 새 API로 근로소득자를 더 등록합니다. BFF가 아니라 새 API에 쓴 값이 현행 형태로 보이는지 확인합니다. */
async function hire(name: string, registrationNumber: string, joinDate = '2026-02-02'): Promise<string> {
  const { token } = await harness.api.signIn('owner@semu.example')
  const response = await harness.api.request('POST', '/v1/employees', {
    token,
    body: { kind: 'WAGE', name, registrationNumber, joinDate },
  })
  expect(response.status).toBe(201)
  return (await response.json()).id
}

describe('GET …/employment/wage-employees/', () => {
  it('lists wage employees from the new API in the DRF envelope and legacy row shape', async () => {
    const response = await client.request('GET', `${CORPORATION}/`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      count: 1,
      next: null,
      previous: null,
      results: [
        expect.objectContaining({
          id: KIM,
          kind: 'wage-salary',
          employment_type: 'wageemployee',
          name: '김세무',
          registration_number: null,
          is_local: true,
          status: 'JOINED',
          status_code: 3,
          status_display: '재직',
          department: 'dpt_01JBQ00000000000000000D3M1',
          department_name: '경영지원팀',
          position_name: '매니저',
          join_date: '2025-03-02',
          leave_date: null,
          has_warning: true,
          warnings: expect.arrayContaining(['missing_required_info']),
          is_rejoin: false,
          version: 1,
        }),
      ],
    })
  })

  it('pages with limit/offset and absolute next/previous links', async () => {
    await hire('박하나', '900101-1234567')
    await hire('최둘', '910202-2234567')

    const first = await (await client.request('GET', `${CORPORATION}/?ordering=name&limit=2`)).json()
    const second = await (await client.request('GET', `${CORPORATION}/?ordering=name&limit=2&offset=2`)).json()

    expect(first.count).toBe(3)
    expect(first.results.map((row: { name: string }) => row.name)).toEqual(['김세무', '박하나'])
    expect(first.next).toBe(`${PUBLIC_BASE_URL}${CORPORATION}/?ordering=name&limit=2&offset=2`)
    expect(first.previous).toBeNull()
    expect(second.results.map((row: { name: string }) => row.name)).toEqual(['최둘'])
    expect(second.next).toBeNull()
    expect(second.previous).toBe(`${PUBLIC_BASE_URL}${CORPORATION}/?ordering=name&limit=2&offset=0`)
  })

  it('filters by the legacy integer status codes and search', async () => {
    await hire('박예정', '900101-1234567', '2099-01-02')

    const preJoined = await (await client.request('GET', `${CORPORATION}/?status=1`)).json()
    const employed = await (await client.request('GET', `${CORPORATION}/?status=2,3`)).json()
    const searched = await (await client.request('GET', `${CORPORATION}/?search=김`)).json()

    expect(preJoined.results.map((row: { name: string }) => row.name)).toEqual(['박예정'])
    expect(preJoined.results[0]).toMatchObject({ status: 'PRE_JOINED', status_code: 1, status_display: '입사예정' })
    expect(employed.count).toBe(1)
    expect(searched.results.map((row: { name: string }) => row.name)).toEqual(['김세무'])
  })

  it('rejects an unknown status with the legacy field error', async () => {
    const response = await client.request('GET', `${CORPORATION}/?status=9`)

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      detail: 'Request validation failed.',
      code: 'VALIDATION_FAILED',
      errors: { status: ['Use status codes 1-5 or PRE_JOINED, WORKING, JOINED, LEAVE, RESIGNED.'] },
    })
  })

  it('switches company with the path and back within one legacy session', async () => {
    const free = await client.request('GET', `${FREE}/`)
    const corporation = await client.request('GET', `${CORPORATION}/`)

    expect(free.status).toBe(403)
    expect(await free.json()).toEqual({
      detail: 'Subscription plan required.',
      code: 'ENTITLEMENT_REQUIRED',
      required_plans: ['PAYROLL', 'TAXATION'],
      promotion_url: null,
    })
    expect(corporation.status).toBe(200)
    expect((await corporation.json()).count).toBe(1)
  })

  it('passes the new permission problem through as the legacy 403', async () => {
    const member = harness.client()
    await member.login('member@semu.example')

    const response = await member.request('GET', `${CORPORATION}/`)

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'PERMISSION_DENIED', permission: 'employee:read' })
  })
})

describe('GET …/employment/wage-employees/count-by-status/', () => {
  it('counts the legacy tabs, where joined includes leave and working does not', async () => {
    await hire('박예정', '900101-1234567', '2099-01-02')

    const response = await client.request('GET', `${CORPORATION}/count-by-status/`)

    expect(await response.json()).toEqual({ all: 2, pre_joined: 1, working: 1, joined: 1, leave: 0, resigned: 0 })
  })
})

describe('GET …/employment/wage-employees/:employeeId/', () => {
  it('returns one employee in the legacy shape with the version ETag', async () => {
    const response = await client.request('GET', `${CORPORATION}/${KIM}/`)

    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe('"1"')
    expect(await response.json()).toMatchObject({
      id: KIM,
      name: '김세무',
      status_code: 3,
      position: expect.any(String),
    })
  })

  it.each([
    ['unknown', 'emp_01JBQ00000000000000000ZZZ9'],
    ['malformed', '42'],
  ])('answers an %s employee ID with the legacy 404', async (_, id) => {
    const response = await client.request('GET', `${CORPORATION}/${id}/`)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ detail: 'Employee not found.', code: 'NOT_FOUND' })
  })

  it('does not serve non-wage employees on the wage path', async () => {
    const response = await client.request('GET', `${CORPORATION}/${FREELANCER}/`)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ detail: 'Employee not found.', code: 'NOT_FOUND' })
  })
})

describe('legacy list search and ordering', () => {
  it('finds employees by department name', async () => {
    await hire('박하나', '900101-1234567')

    const response = await client.request('GET', `${CORPORATION}/?search=경영지원`)

    expect((await response.json()).results.map((row: { name: string }) => row.name)).toEqual(['김세무'])
  })

  it('sorts by name without ordering and by several keys with ordering', async () => {
    await hire('가나다', '900101-1234567', '2099-01-02')
    await hire('하하', '910202-2234567')

    const byDefault = await (await client.request('GET', `${CORPORATION}/`)).json()
    const byStatus = await (await client.request('GET', `${CORPORATION}/?ordering=-status,name`)).json()

    expect(byDefault.results.map((row: { name: string }) => row.name)).toEqual(['가나다', '김세무', '하하'])
    expect(byStatus.results.map((row: { name: string }) => row.name)).toEqual(['김세무', '하하', '가나다'])
  })
})

describe('upstream limits', () => {
  it('stops reading a cursor list that never ends', async () => {
    const endless = makeHarness({
      maxUpstreamPages: 3,
      intercept: async (request, next) => {
        const url = new URL(request.url)
        if (url.pathname !== '/v1/employees') return next(request)
        const page = Number(url.searchParams.get('cursor') ?? '0') + 1
        return Response.json({ items: [], nextCursor: String(page) })
      },
    })
    const legacy = endless.client()
    await legacy.login('owner@semu.example')

    const response = await legacy.request('GET', `${CORPORATION}/`)

    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ code: 'UPSTREAM_LIST_TOO_LARGE' })
    await endless.dispose()
  })

  it('stops when the new API repeats a cursor', async () => {
    const looping = makeHarness({
      intercept: async (request, next) =>
        new URL(request.url).pathname === '/v1/employees'
          ? Response.json({ items: [], nextCursor: 'same' })
          : next(request),
    })
    const legacy = looping.client()
    await legacy.login('owner@semu.example')

    const response = await legacy.request('GET', `${CORPORATION}/count-by-status/`)

    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ code: 'UPSTREAM_CURSOR_REPEATED' })
    await looping.dispose()
  })
})
