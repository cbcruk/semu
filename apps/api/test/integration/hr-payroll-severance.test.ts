import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startTestApp, type TestApp } from '../../src/modules/hr/shared/http-test-support.ts'

let app: TestApp

beforeEach(() => {
  app = startTestApp()
})

afterEach(async () => {
  await app.dispose()
})

const RESIGNATION = { leavingReasonCode: '23', leavingDetailReasonCode: '23-2' }

/** HR에 직원을 등록하고 2026-06-30에 퇴사시킨 뒤 Payroll에서 퇴직금 정산을 계산합니다. */
async function resignWithSettlement(): Promise<{ employeeId: string; settlementId: string }> {
  const hired = await app.json('POST', '/employees', {
    body: { kind: 'WAGE', name: '홍길동', registrationNumber: '900101-1234567', joinDate: '2024-01-02' },
  })
  expect(hired.status).toBe(201)
  const employeeId: string = hired.body.id
  const resigned = await app.json('POST', `/employees/${employeeId}:resign`, {
    body: { leaveDate: '2026-06-30', ...RESIGNATION },
  })
  expect(resigned.status).toBe(200)
  const settlement = await app.json('POST', '/severance-settlements', {
    body: { employeeId, input: { threeMonthWages: 9_000_000 } },
  })
  expect(settlement.status).toBe(201)
  expect(settlement.body.retirementMismatch).toBeNull()
  return { employeeId, settlementId: settlement.body.id }
}

const complete = (settlementId: string) => app.json('POST', `/severance-settlements/${settlementId}:complete`)

describe('퇴직금 정산 완료의 HR 퇴직일 대조', () => {
  it('HR 퇴직일이 그대로면 완료합니다', async () => {
    const { settlementId } = await resignWithSettlement()

    const completed = await complete(settlementId)

    expect(completed.status).toBe(200)
    expect(completed.body).toMatchObject({ status: 'COMPLETED', retirementMismatch: null, allowedActions: ['REOPEN'] })
  })

  it('퇴사를 취소한 뒤 완료하면 409 SEVERANCE_RETIREMENT_MISMATCH(NOT_LEFT)로 거절합니다', async () => {
    const { employeeId, settlementId } = await resignWithSettlement()
    expect((await app.json('POST', `/employees/${employeeId}:cancel-resignation`)).status).toBe(200)

    const completed = await complete(settlementId)

    expect(completed.status).toBe(409)
    expect(completed.body).toMatchObject({
      code: 'SEVERANCE_RETIREMENT_MISMATCH',
      reason: 'NOT_LEFT',
      lastWorkDate: '2026-06-30',
      leaveDate: null,
    })
    expect((await app.json('GET', `/severance-settlements/${settlementId}`)).body.status).toBe('CALCULATED')
  })

  it('직원을 삭제한 뒤 완료하면 409 SEVERANCE_RETIREMENT_MISMATCH(EMPLOYEE_NOT_FOUND)로 거절합니다', async () => {
    const { employeeId, settlementId } = await resignWithSettlement()
    expect((await app.request('DELETE', `/employees/${employeeId}`)).status).toBe(204)

    const completed = await complete(settlementId)

    expect(completed.status).toBe(409)
    expect(completed.body).toMatchObject({
      code: 'SEVERANCE_RETIREMENT_MISMATCH',
      reason: 'EMPLOYEE_NOT_FOUND',
      leaveDate: null,
    })
  })

  it('다른 날로 다시 퇴사한 뒤 완료하면 409 SEVERANCE_RETIREMENT_MISMATCH(LEAVE_DATE_CHANGED)로 거절합니다', async () => {
    const { employeeId, settlementId } = await resignWithSettlement()
    const reResigned = await app.json('POST', `/employees/${employeeId}:resign`, {
      body: { leaveDate: '2026-07-31', ...RESIGNATION },
    })
    expect(reResigned.status).toBe(200)

    const completed = await complete(settlementId)

    expect(completed.status).toBe(409)
    expect(completed.body).toMatchObject({
      code: 'SEVERANCE_RETIREMENT_MISMATCH',
      reason: 'LEAVE_DATE_CHANGED',
      lastWorkDate: '2026-06-30',
      leaveDate: '2026-07-31',
    })
  })

  it('목록과 상세가 어긋난 정산을 표시하고 완료 대신 제외만 허용하며, 지금 퇴직일로 새 정산을 완료할 수 있습니다', async () => {
    const { employeeId, settlementId } = await resignWithSettlement()
    await app.json('POST', `/employees/${employeeId}:resign`, { body: { leaveDate: '2026-07-31', ...RESIGNATION } })

    const list = await app.json('GET', '/severance-settlements?status=CALCULATED')
    expect(list.status).toBe(200)
    expect(list.body.items).toEqual([
      expect.objectContaining({
        id: settlementId,
        retirementMismatch: 'LEAVE_DATE_CHANGED',
        allowedActions: ['UPDATE', 'EXCLUDE'],
      }),
    ])
    const detail = await app.json('GET', `/severance-settlements/${settlementId}`)
    expect(detail.body).toMatchObject({
      retirementMismatch: 'LEAVE_DATE_CHANGED',
      allowedActions: ['UPDATE', 'EXCLUDE'],
    })

    const excluded = await app.json('POST', `/severance-settlements/${settlementId}:exclude`)
    expect(excluded.body).toMatchObject({ status: 'EXCLUDED', retirementMismatch: 'LEAVE_DATE_CHANGED' })
    const fresh = await app.json('POST', '/severance-settlements', {
      body: { employeeId, input: { threeMonthWages: 9_000_000 } },
    })
    expect(fresh.body).toMatchObject({ lastWorkDate: '2026-07-31', retirementMismatch: null })
    expect((await complete(fresh.body.id)).body.status).toBe('COMPLETED')
  })
})
