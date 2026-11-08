import { Effect, Layer } from 'effect'
import { afterAll, describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import {
  type PersonalDataAccess,
  PersonalDataAccessLog,
} from '../../../shared/personal-data/personal-data-access-log.ts'
import { TEST_COMPANY_ID, testActor } from '../../identity-access/testing.ts'
import { payrollTestApp } from '../payroll-testing.ts'

const accesses: PersonalDataAccess[] = []
const RecordingAccessLog = Layer.succeed(
  PersonalDataAccessLog,
  PersonalDataAccessLog.of({
    record: (access) => Effect.sync(() => void accesses.push(access)),
    list: () => Effect.sync(() => accesses),
  }),
)

const OTHER_COMPANY_ID = 'cmp_01JBQ000000000000000000009' as Id<'company'>

const app = payrollTestApp(
  [RecordingAccessLog],
  [
    ['reader', testActor({ permissions: new Set(['earner:read']) })],
    ['other-company', testActor({ companyId: OTHER_COMPANY_ID })],
    ['no-plan', testActor({ plans: new Set() })],
  ],
)

afterAll(() => app.dispose())

const create = (body: Record<string, unknown>) => app.request('POST', '/earners', { body })

describe('소득자 명부', () => {
  it('주민등록번호는 가린 값만 돌려주고 원문·암호문은 응답에 싣지 않습니다', async () => {
    const response = await create({
      name: ' 박프리 ',
      identityType: 'RESIDENT',
      registrationNumber: '850505-1234567',
      email: 'free@example.com',
      departmentName: '디자인',
    })

    expect(response.status).toBe(201)
    expect(response.headers.get('etag')).toBe('"1"')
    expect(response.body).toEqual({
      id: expect.stringMatching(/^ern_/),
      name: '박프리',
      identityType: 'RESIDENT',
      registrationNumberMasked: '850505-1******',
      email: 'free@example.com',
      departmentName: '디자인',
      version: 1,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    })
    expect(JSON.stringify(response.body)).not.toContain('1234567')
  })

  it('외국인등록번호와 여권번호로도 올리고, 여권번호는 끝 3자리만 보입니다', async () => {
    const alien = await create({ name: '응우옌', identityType: 'ALIEN', registrationNumber: '9203036123456' })
    const passport = await create({ name: '스미스', identityType: 'PASSPORT', registrationNumber: 'x98765432' })

    expect(alien.status).toBe(201)
    expect(alien.body).toMatchObject({ registrationNumberMasked: '920303-6******', email: null, departmentName: null })
    expect(passport.status).toBe(201)
    expect(passport.body).toMatchObject({ identityType: 'PASSPORT', registrationNumberMasked: '******432' })
  })

  it.each([
    ['RESIDENT', '920303-6123456'],
    ['ALIEN', '850505-1234560'],
    ['RESIDENT', '901301-1234567'],
    ['PASSPORT', 'AB-12'],
  ])('%s 형식에 맞지 않는 번호(%s)는 422입니다', async (identityType, registrationNumber) => {
    const response = await create({ name: '틀린번호', identityType, registrationNumber })

    expect(response.status).toBe(422)
    expect(response.body).toMatchObject({
      code: 'EARNER_INVALID',
      violations: [{ field: 'registrationNumber', code: 'INVALID_FORMAT' }],
    })
  })

  it('같은 회사에 같은 신원번호가 있으면 409로 기존 소득자를 알려 줍니다', async () => {
    const first = await create({ name: '김중복', identityType: 'RESIDENT', registrationNumber: '7707071234567' })
    const second = await create({ name: '김중복', identityType: 'RESIDENT', registrationNumber: '770707-1234567' })

    expect(second.status).toBe(409)
    expect(second.body).toMatchObject({ code: 'EARNER_DUPLICATE', duplicateEarnerId: first.body.id })
  })

  it('다른 회사의 소득자는 보이지 않고 같은 번호도 따로 올릴 수 있습니다', async () => {
    const mine = await create({ name: '최회사', identityType: 'RESIDENT', registrationNumber: '6606061234567' })
    const theirs = await app.request('POST', '/earners', {
      token: 'other-company',
      body: { name: '최회사', identityType: 'RESIDENT', registrationNumber: '6606061234567' },
    })
    const peek = await app.request('GET', `/earners/${mine.body.id}`, { token: 'other-company' })

    expect(theirs.status).toBe(201)
    expect(peek.status).toBe(404)
    expect(peek.body).toMatchObject({ code: 'EARNER_NOT_FOUND' })
  })

  it('목록은 올린 순서이고 전체 건수를 함께 줍니다', async () => {
    const page = await app.request('GET', '/earners?limit=2')
    const all = await app.request('GET', '/earners?limit=100')

    expect(page.status).toBe(200)
    expect(page.body.items).toHaveLength(2)
    expect(page.body.nextCursor).toEqual(expect.any(String))
    expect(all.body.totalCount).toBe(all.body.items.length)
    expect(all.body.items.map((item: { name: string }) => item.name).slice(0, 2)).toEqual(['박프리', '응우옌'])
    expect(JSON.stringify(all.body)).not.toMatch(/Encrypted|Hash|enc:/)
  })

  it('고칠 때 이메일·부서는 null로 지우고, 버전이 다르면 412입니다', async () => {
    const created = await create({
      name: '정수정',
      identityType: 'RESIDENT',
      registrationNumber: '8808081234567',
      email: 'jung@example.com',
      departmentName: '물류',
    })
    const stale = await app.request('PATCH', `/earners/${created.body.id}`, {
      ifMatch: '"7"',
      body: { name: '정수정2' },
    })
    const updated = await app.request('PATCH', `/earners/${created.body.id}`, {
      ifMatch: created.headers.get('etag') ?? undefined,
      body: { email: null, departmentName: null },
    })

    expect(stale.status).toBe(412)
    expect(updated.status).toBe(200)
    expect(updated.body).toMatchObject({ name: '정수정', email: null, departmentName: null, version: 2 })
  })

  it('신원번호 종류를 바꾸려면 번호도 함께 줘야 합니다', async () => {
    const created = await create({ name: '한종류', identityType: 'RESIDENT', registrationNumber: '9909091234567' })
    const typeOnly = await app.request('PATCH', `/earners/${created.body.id}`, { body: { identityType: 'PASSPORT' } })
    const both = await app.request('PATCH', `/earners/${created.body.id}`, {
      body: { identityType: 'PASSPORT', registrationNumber: 'M55554444' },
    })

    expect(typeOnly.status).toBe(422)
    expect(typeOnly.body).toMatchObject({ violations: [{ field: 'registrationNumber', code: 'REQUIRED' }] })
    expect(both.status).toBe(200)
    expect(both.body).toMatchObject({ identityType: 'PASSPORT', registrationNumberMasked: '******444' })
  })

  it('번호를 바꿀 때 자기 자신과는 중복으로 보지 않습니다', async () => {
    const created = await create({ name: '오자기', identityType: 'RESIDENT', registrationNumber: '5505051234567' })
    const same = await app.request('PATCH', `/earners/${created.body.id}`, {
      body: { registrationNumber: '550505-1234567' },
    })

    expect(same.status).toBe(200)
  })

  it('원문은 사유를 받아 열람 기록을 남기고 보여 줍니다', async () => {
    const created = await create({ name: '서열람', identityType: 'ALIEN', registrationNumber: '010101-7123456' })
    const revealed = await app.request('POST', `/earners/${created.body.id}/registration-number:reveal`, {
      headers: { 'x-access-reason': encodeURIComponent('지급명세서 제출') },
    })

    expect(revealed.status).toBe(200)
    expect(revealed.body).toEqual({ identityType: 'ALIEN', registrationNumber: '0101017123456' })
    expect(accesses.at(-1)).toMatchObject({
      companyId: TEST_COMPANY_ID,
      target: `earner:${created.body.id}:registrationNumber`,
      reason: '지급명세서 제출',
    })
  })

  it('열람 사유가 없으면 400이고 기록을 남기지 않습니다', async () => {
    const created = await create({ name: '무사유', identityType: 'RESIDENT', registrationNumber: '4404041234567' })
    const before = accesses.length
    const revealed = await app.request('POST', `/earners/${created.body.id}/registration-number:reveal`)

    expect(revealed.status).toBe(400)
    expect(accesses).toHaveLength(before)
  })

  it('열람 권한이 없으면 403이고, 읽기 권한으로는 가린 값만 봅니다', async () => {
    const created = await create({ name: '권한', identityType: 'RESIDENT', registrationNumber: '3303031234567' })
    const read = await app.request('GET', `/earners/${created.body.id}`, { token: 'reader' })
    const revealed = await app.request('POST', `/earners/${created.body.id}/registration-number:reveal`, {
      token: 'reader',
      headers: { 'x-access-reason': 'check' },
    })
    const write = await app.request('POST', '/earners', {
      token: 'reader',
      body: { name: '쓰기', identityType: 'RESIDENT', registrationNumber: '3303031234568' },
    })

    expect(read.status).toBe(200)
    expect(revealed.status).toBe(403)
    expect(revealed.body).toMatchObject({ code: 'PERMISSION_DENIED', permission: 'earner:reveal-rrn' })
    expect(write.status).toBe(403)
  })

  it('급여·세무 플랜이 모두 없으면 명부를 열지 않습니다', async () => {
    const response = await app.request('GET', '/earners', { token: 'no-plan' })

    expect(response.status).toBe(403)
    expect(response.body).toMatchObject({ code: 'ENTITLEMENT_REQUIRED' })
  })

  it('공백뿐인 이름은 올리거나 고칠 때 422입니다', async () => {
    const created = await create({ name: '   ', identityType: 'PASSPORT', registrationNumber: 'B00000001' })
    const valid = await create({ name: '공백', identityType: 'PASSPORT', registrationNumber: 'B00000002' })
    const updated = await app.request('PATCH', `/earners/${valid.body.id}`, { body: { name: ' ' } })

    expect(created.status).toBe(422)
    expect(created.body).toMatchObject({ code: 'EARNER_INVALID', violations: [{ field: 'name', code: 'REQUIRED' }] })
    expect(updated.status).toBe(422)
    expect(updated.body).toMatchObject({ code: 'EARNER_INVALID', violations: [{ field: 'name', code: 'REQUIRED' }] })
  })

  it('번호 문자열이 같아도 종류가 다르면 다른 소득자로 봅니다', async () => {
    const resident = await create({ name: '같은번호', identityType: 'RESIDENT', registrationNumber: '7101011234567' })
    const passport = await create({ name: '같은번호', identityType: 'PASSPORT', registrationNumber: '7101011234567' })

    expect(resident.status).toBe(201)
    expect(passport.status).toBe(201)
  })

  it('쓰이지 않는 소득자는 지우고, 지운 소득자는 404입니다', async () => {
    const created = await create({ name: '삭제', identityType: 'PASSPORT', registrationNumber: 'D00000001' })
    const removed = await app.request('DELETE', `/earners/${created.body.id}`)
    const again = await app.request('GET', `/earners/${created.body.id}`)

    expect(removed.status).toBe(204)
    expect(again.status).toBe(404)
  })
})
