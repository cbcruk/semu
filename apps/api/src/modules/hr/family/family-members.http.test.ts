import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startTestApp, type TestApp } from '../shared/http-test-support.ts'

let app: TestApp

beforeEach(() => {
  app = startTestApp()
})

afterEach(async () => {
  await app.dispose()
})

const hire = async (kind = 'WAGE') =>
  (await app.json('POST', '/employees', { body: { kind, name: '홍길동', joinDate: '2026-01-02' } })).body.id as string

const spouse = {
  name: '김배우',
  birthDate: '1990-01-01',
  relation: 'SPOUSE',
  yearEndTarget: true,
  yearEndDependantType: 'SPOUSE',
}

/** 피부양자 신고서에 주민번호가 들어가서 피부양자로 둘 때는 주민번호가 있어야 합니다. */
const dependant = { ...spouse, registrationNumber: '900101-2234567', healthInsuranceDependant: true }
const notDependant = { ...spouse, registrationNumber: '900101-2234567' }

type Filing = { id: string; status: string; payload: Record<string, unknown> }

const dependantFilings = async (employeeId: string) =>
  ((await app.json('GET', `/insurance-filings?kind=DEPENDANT&employeeId=${employeeId}`)).body.items as Filing[]).map(
    ({ status, payload }) => ({ status, change: payload.change, name: payload.name }),
  )

const complete = async (employeeId: string) => {
  const pending = (await app.json('GET', `/insurance-filings?kind=DEPENDANT&status=PENDING&employeeId=${employeeId}`))
    .body.items as Filing[]
  for (const filing of pending) {
    expect((await app.json('POST', `/insurance-filings/${filing.id}:complete`, { token: 'agent' })).status).toBe(200)
  }
}

describe('인적공제 대상자(/v1/employees/{employeeId}/family-members, /v1/family-members/{id})', () => {
  it('등록·조회·수정·삭제합니다', async () => {
    const employeeId = await hire()
    const created = await app.json('POST', `/employees/${employeeId}/family-members`, { body: spouse })
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({
      employeeId,
      isForeigner: false,
      taxFreeTarget: false,
      healthInsuranceDependant: false,
      version: 1,
    })

    const path = `/family-members/${created.body.id}`
    const fetched = await app.request('GET', path)
    expect(fetched.headers.get('etag')).toBe('"1"')

    const updated = await app.json('PUT', path, { body: { ...spouse, name: '김배우자' }, ifMatch: '"1"' })
    expect(updated.body).toMatchObject({ name: '김배우자', version: 2 })
    const stale = await app.json('PUT', path, { body: spouse, ifMatch: '"1"' })
    expect(stale.status).toBe(412)

    const list = await app.json('GET', `/employees/${employeeId}/family-members`)
    expect(list.body.items).toHaveLength(1)

    expect((await app.json('DELETE', path)).status).toBe(204)
    expect((await app.json('GET', path)).body).toMatchObject({ code: 'FAMILY_MEMBER_NOT_FOUND' })
  })

  it('규칙 위반을 모두 모읍니다', async () => {
    const employeeId = await hire()
    const response = await app.json('POST', `/employees/${employeeId}/family-members`, {
      body: { ...spouse, taxFreeTarget: true, yearEndDependantType: 'NOT_ELIGIBLE', registrationNumber: '12' },
    })

    expect(response.status).toBe(422)
    expect(response.body).toMatchObject({
      code: 'FAMILY_MEMBER_INVALID',
      violations: [
        { field: 'taxFreeTarget', code: 'NOT_ELIGIBLE' },
        { field: 'yearEndDependantType', code: 'REQUIRED' },
        { field: 'registrationNumber', code: 'INVALID_FORMAT' },
      ],
    })
  })

  it('근로소득자가 아닌 직원은 거절합니다', async () => {
    const employeeId = await hire('OTHER')
    const response = await app.json('POST', `/employees/${employeeId}/family-members`, { body: spouse })

    expect(response.status).toBe(422)
    expect(response.body).toMatchObject({ code: 'EMPLOYEE_KIND_NOT_SUPPORTED' })
  })

  it('주민번호는 가려 보여 주고 열람 권한과 사유가 있어야 원문을 줍니다', async () => {
    const employeeId = await hire()
    const created = await app.json('POST', `/employees/${employeeId}/family-members`, {
      body: { ...spouse, registrationNumber: '900101-2234567' },
    })
    expect(created.body).toMatchObject({ registrationNumberMasked: '900101-2******' })
    expect(created.body).not.toHaveProperty('registrationNumberEncrypted')

    const path = `/family-members/${created.body.id}/registration-number:reveal`
    const denied = await app.json('POST', path, { token: 'viewer', headers: { 'x-access-reason': 'check' } })
    expect(denied.status).toBe(403)
    const revealed = await app.json('POST', path, { headers: { 'x-access-reason': encodeURIComponent('연말정산') } })
    expect(revealed.body).toEqual({ registrationNumber: '9001012234567' })

    // 수정할 때 주민번호를 비우면 지웁니다.
    const cleared = await app.json('PUT', `/family-members/${created.body.id}`, { body: spouse })
    expect(cleared.body).not.toHaveProperty('registrationNumberMasked')
    expect((await app.json('POST', path, { headers: { 'x-access-reason': 'check' } })).status).toBe(404)
  })

  it('직원을 지우면 가족도 지웁니다', async () => {
    const employeeId = await hire()
    const created = await app.json('POST', `/employees/${employeeId}/family-members`, { body: spouse })
    expect((await app.json('DELETE', `/employees/${employeeId}`)).status).toBe(204)
    expect((await app.json('GET', `/family-members/${created.body.id}`)).status).toBe(404)
  })

  it('읽기 권한만 있으면 조회만 합니다', async () => {
    const employeeId = await hire()
    expect((await app.json('GET', `/employees/${employeeId}/family-members`, { token: 'viewer' })).status).toBe(200)
    const denied = await app.json('POST', `/employees/${employeeId}/family-members`, { token: 'viewer', body: spouse })
    expect(denied.status).toBe(403)
  })
})

describe('피부양자 신고', () => {
  it('피부양자로 등록하면 취득 신고를 열고, 처리 전에 끄면 닫습니다', async () => {
    const employeeId = await hire()
    const created = await app.json('POST', `/employees/${employeeId}/family-members`, {
      body: dependant,
    })
    expect(await dependantFilings(employeeId)).toEqual([{ status: 'PENDING', change: 'ADD', name: '김배우' }])

    await app.json('PUT', `/family-members/${created.body.id}`, { body: notDependant, ifMatch: '"1"' })
    expect(await dependantFilings(employeeId)).toEqual([{ status: 'WITHDRAWN', change: 'ADD', name: '김배우' }])
  })

  it('처리 전에 이름을 고치면 새 내용으로 다시 엽니다', async () => {
    const employeeId = await hire()
    const created = await app.json('POST', `/employees/${employeeId}/family-members`, {
      body: dependant,
    })
    await app.json('PUT', `/family-members/${created.body.id}`, {
      body: { ...dependant, name: '김배우자' },
      ifMatch: '"1"',
    })
    // 내용이 같으면 그대로 둡니다.
    await app.json('PUT', `/family-members/${created.body.id}`, {
      body: { ...dependant, name: '김배우자', isForeigner: false },
      ifMatch: '"2"',
    })

    expect(await dependantFilings(employeeId)).toEqual([
      { status: 'WITHDRAWN', change: 'ADD', name: '김배우' },
      { status: 'PENDING', change: 'ADD', name: '김배우자' },
    ])
  })

  it('등록을 마친 피부양자를 끄면 상실 신고를 열고, 상실을 마치기 전에는 지울 수 없습니다', async () => {
    const employeeId = await hire()
    const created = await app.json('POST', `/employees/${employeeId}/family-members`, { body: dependant })
    await complete(employeeId)

    const path = `/family-members/${created.body.id}`
    const blocked = await app.json('DELETE', path)
    expect(blocked.status).toBe(409)
    expect(blocked.body).toMatchObject({ code: 'FAMILY_MEMBER_DEPENDANT_REGISTERED' })

    await app.json('PUT', path, { body: notDependant, ifMatch: '"1"' })
    expect((await dependantFilings(employeeId)).at(-1)).toEqual({ status: 'PENDING', change: 'REMOVE', name: '김배우' })

    // 상실 신고를 처리하기 전에 다시 켜면 공단 상태와 같아져 상실 신고만 닫습니다.
    await app.json('PUT', path, { body: dependant, ifMatch: '"2"' })
    expect(await dependantFilings(employeeId)).toEqual([
      { status: 'DONE', change: 'ADD', name: '김배우' },
      { status: 'WITHDRAWN', change: 'REMOVE', name: '김배우' },
    ])

    // 끄고 상실 신고를 마치면 지울 수 있고, 지워도 새 신고는 열지 않습니다.
    await app.json('PUT', path, { body: notDependant, ifMatch: '"3"' })
    await complete(employeeId)
    expect((await app.json('DELETE', path)).status).toBe(204)
    expect((await dependantFilings(employeeId)).filter((filing) => filing.status === 'PENDING')).toEqual([])
  })

  it('실패한 취득 신고는 내용이 바뀌면 닫고 새로 엽니다', async () => {
    const employeeId = await hire()
    const created = await app.json('POST', `/employees/${employeeId}/family-members`, { body: dependant })
    const [filing] = (await app.json('GET', `/insurance-filings?kind=DEPENDANT&employeeId=${employeeId}`)).body
      .items as Filing[]
    await app.json('POST', `/insurance-filings/${filing!.id}:fail`, {
      token: 'agent',
      body: { message: '이름 불일치' },
    })

    await app.json('PUT', `/family-members/${created.body.id}`, {
      body: { ...dependant, name: '김배우자' },
      ifMatch: '"1"',
    })
    expect(await dependantFilings(employeeId)).toEqual([
      { status: 'WITHDRAWN', change: 'ADD', name: '김배우' },
      { status: 'PENDING', change: 'ADD', name: '김배우자' },
    ])
  })

  it('직원을 지우면 열린 피부양자 신고를 닫고 상실 신고는 열지 않습니다', async () => {
    const employeeId = await hire()
    const other = await hire()
    await app.json('POST', `/employees/${employeeId}/family-members`, { body: dependant })
    const kept = await app.json('POST', `/employees/${other}/family-members`, { body: spouse })

    expect((await app.json('DELETE', `/employees/${employeeId}`)).status).toBe(204)
    expect(await dependantFilings(employeeId)).toEqual([{ status: 'WITHDRAWN', change: 'ADD', name: '김배우' }])
    expect((await app.json('GET', `/family-members/${kept.body.id}`)).status).toBe(200)
  })
})
