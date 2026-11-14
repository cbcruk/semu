import { Result } from 'effect'
import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { BUILT_IN_RATE_TABLES } from '../engine/rate-tables-2026.ts'
import { testEmployee } from '../payroll-test-fixtures.ts'
import { decideSeveranceCreation, decideSeveranceTransition } from './severance-settlement.aggregate.ts'
import type { SeveranceSettlementRecord } from './severance-settlement.types.ts'

const COMPANY = 'cmp_01JBQ000000000000000000001' as Id<'company'>
const AT = '2026-11-14T01:00:00.000Z'
const NONE_FILED: ReadonlySet<string> = new Set()
const LEAVER = testEmployee({ joinDate: '2023-01-01', leaveDate: '2026-10-31' })
const INPUT = { threeMonthWages: 9_000_000 }

function create(
  employee = LEAVER,
  overrides: { paymentDate?: string; filed?: ReadonlySet<string>; settlements?: SeveranceSettlementRecord[] } = {},
) {
  return decideSeveranceCreation(
    {
      id: 'sev_01JBQ000000000000000000001' as Id<'severanceSettlement'>,
      companyId: COMPANY,
      employeeId: employee.id,
      input: INPUT,
      ...(overrides.paymentDate === undefined ? {} : { paymentDate: overrides.paymentDate }),
    },
    {
      settlements: overrides.settlements ?? [],
      filedPaymentMonths: overrides.filed ?? NONE_FILED,
      rateTables: BUILT_IN_RATE_TABLES,
      employee,
      today: '2026-11-14',
    },
    AT,
  )
}

function calculated(): SeveranceSettlementRecord {
  const result = create()
  if (Result.isFailure(result)) throw result.failure
  return result.success.settlement
}

describe('decideSeveranceCreation', () => {
  it('퇴사한 퇴직금 제도 직원의 퇴직일까지 계산하고, 계산됨 정산은 원천세에 들지 않아 이벤트가 없습니다', () => {
    const result = create()

    expect(Result.isSuccess(result) && result.success.settlement).toMatchObject({
      kind: 'RETIREMENT',
      status: 'CALCULATED',
      joinDate: '2023-01-01',
      serviceStartDate: '2023-01-01',
      lastWorkDate: '2026-10-31',
      version: 1,
    })
    expect(Result.isSuccess(result) && result.success.settlement.result.severancePay).toBeGreaterThan(0)
    expect(Result.isSuccess(result) && result.success.events).toEqual([])
  })

  it('재직 중이거나 퇴직연금 직원, 같은 퇴직의 정산이 있으면 거부합니다', () => {
    const stayer = create(testEmployee({ leaveDate: null }))
    const pension = create(testEmployee({ leaveDate: '2026-10-31', retirementBenefitType: 'DEFINED_CONTRIBUTION' }))
    const duplicated = create(LEAVER, { settlements: [calculated()] })

    expect(Result.isFailure(stayer) && stayer.failure).toMatchObject({ reason: 'NOT_LEFT' })
    expect(Result.isFailure(pension) && pension.failure).toMatchObject({ reason: 'NOT_SEVERANCE_PAY_PLAN' })
    expect(Result.isFailure(duplicated) && duplicated.failure).toMatchObject({ code: 'SEVERANCE_SETTLEMENT_EXISTS' })
  })

  it('지급일이 퇴직일보다 앞서거나 신고된 달이면 거부합니다', () => {
    const early = create(LEAVER, { paymentDate: '2026-10-30' })
    const filed = create(LEAVER, { paymentDate: '2026-11-10', filed: new Set(['2026-11']) })

    expect(Result.isFailure(early) && early.failure).toMatchObject({ lastWorkDate: '2026-10-31' })
    expect(Result.isFailure(filed) && filed.failure).toMatchObject({
      code: 'WITHHOLDING_FILED',
      paymentMonth: '2026-11',
    })
  })
})

describe('decideSeveranceTransition', () => {
  it('완료하면 지급일을 퇴직일로 채우고 그 달 원천세가 바뀌었다는 이벤트를 냅니다', () => {
    const result = decideSeveranceTransition(
      calculated(),
      'COMPLETE',
      { settlements: [], filedPaymentMonths: NONE_FILED, employeeNow: { leaveDate: '2026-10-31' } },
      AT,
    )

    expect(Result.isSuccess(result) && result.success.settlement).toMatchObject({
      status: 'COMPLETED',
      paymentDate: '2026-10-31',
      version: 2,
    })
    expect(Result.isSuccess(result) && result.success.events).toMatchObject([
      { type: 'payroll_pay_month.withholding_changed', companyId: COMPANY, paymentMonth: '2026-10' },
    ])
  })

  it('HR 퇴직일이 바뀌었거나 그 달이 신고됐으면 완료하지 않습니다', () => {
    const settlement = calculated()
    const canceled = decideSeveranceTransition(
      settlement,
      'COMPLETE',
      { settlements: [], filedPaymentMonths: NONE_FILED, employeeNow: { leaveDate: null } },
      AT,
    )
    const filed = decideSeveranceTransition(
      settlement,
      'COMPLETE',
      { settlements: [], filedPaymentMonths: new Set(['2026-10']), employeeNow: { leaveDate: '2026-10-31' } },
      AT,
    )

    expect(Result.isFailure(canceled) && canceled.failure).toMatchObject({
      code: 'SEVERANCE_RETIREMENT_MISMATCH',
      leaveDate: null,
    })
    expect(Result.isFailure(filed) && filed.failure).toMatchObject({ code: 'WITHHOLDING_FILED' })
  })
})
