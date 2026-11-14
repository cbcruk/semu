import { Result } from 'effect'
import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { BUILT_IN_RATE_TABLES } from '../engine/rate-tables-2026.ts'
import { decideLedgerCreation } from '../ledgers/payroll-ledger.aggregate.ts'
import type { PayrollLedgerRecord } from '../ledgers/payroll-ledger.types.ts'
import { rateBasedSetting, testEmployee } from '../payroll-test-fixtures.ts'
import {
  decideWageSettlementCreation,
  decideWageSettlementDeletion,
  wageSettlementBasisDate,
} from './wage-tax-settlement.aggregate.ts'
import type { WageSettlementFacts } from './wage-tax-settlement.aggregate.ts'
import type { WageTaxSettlementRecord } from './wage-tax-settlement.types.ts'

const COMPANY = 'cmp_01JBQ000000000000000000001' as Id<'company'>
const AT = '2027-01-10T01:00:00.000Z'
const STAYER = testEmployee()

/** 2026년 12월 귀속의 마감된 정기 대장입니다. 그해 근로소득이 됩니다. */
function closedLedger(): PayrollLedgerRecord {
  const created = decideLedgerCreation(
    { id: 'pld_01JBQ000000000000000000R01' as Id<'payrollLedger'>, companyId: COMPANY, attributionMonth: '2026-12' },
    {
      ledgers: [],
      filedPaymentMonths: new Set(),
      rateTables: BUILT_IN_RATE_TABLES,
      setting: rateBasedSetting(),
      catalog: { paymentItems: new Map(), deductionItems: new Map() },
      wageEarners: [STAYER],
    },
    AT,
  )
  if (Result.isFailure(created)) throw created.failure
  return { ...created.success.ledger, status: 'CLOSED', closedAt: AT }
}

function facts(overrides: Partial<WageSettlementFacts> = {}): WageSettlementFacts {
  return {
    employeeNow: STAYER,
    employeeAtBasis: STAYER,
    ledgers: [closedLedger()],
    rateTables: BUILT_IN_RATE_TABLES,
    filedPaymentMonths: new Set(),
    today: '2027-01-10',
    ...overrides,
  }
}

function create(kind: 'MID_YEAR' | 'ANNUAL', settlements: WageTaxSettlementRecord[] = []) {
  return decideWageSettlementCreation(
    {
      id: 'wts_01JBQ000000000000000000001' as Id<'wageTaxSettlement'>,
      companyId: COMPANY,
      kind,
      employeeId: STAYER.id,
      year: '2026',
    },
    { ...facts(), settlements },
    AT,
  )
}

describe('wageSettlementBasisDate', () => {
  it('중도퇴사는 퇴사일, 연말정산과 재직자는 그해 12월 31일의 HR 값을 씁니다', () => {
    expect(wageSettlementBasisDate('MID_YEAR', '2026', '2026-03-31')).toBe('2026-03-31')
    expect(wageSettlementBasisDate('MID_YEAR', '2026', null)).toBe('2026-12-31')
    expect(wageSettlementBasisDate('ANNUAL', '2026', '2026-03-31')).toBe('2026-12-31')
  })
})

describe('decideWageSettlementCreation', () => {
  it('재직자의 연말정산은 계산됨으로 만들고 원천세 이벤트는 내지 않습니다', () => {
    const result = create('ANNUAL')

    expect(Result.isSuccess(result) && result.success.settlement).toMatchObject({
      kind: 'ANNUAL',
      year: '2026',
      status: 'CALCULATED',
      dependants: 1,
      version: 1,
    })
    expect(Result.isSuccess(result) && result.success.events).toEqual([])
  })

  it('그해 퇴사하지 않은 직원의 중도퇴사 정산과 같은 직원·연도·종류의 두 번째 정산은 거부합니다', () => {
    const notLeft = create('MID_YEAR')
    const first = create('ANNUAL')
    if (Result.isFailure(first)) throw first.failure
    const duplicated = create('ANNUAL', [first.success.settlement])

    expect(Result.isFailure(notLeft) && notLeft.failure).toMatchObject({ reason: 'NOT_LEFT_IN_YEAR' })
    expect(Result.isFailure(duplicated) && duplicated.failure).toMatchObject({
      code: 'WAGE_SETTLEMENT_EXISTS',
      settlementId: first.success.settlement.id,
    })
  })

  it('HR에 없는 직원은 거부합니다', () => {
    const result = decideWageSettlementCreation(
      {
        id: 'wts_01JBQ000000000000000000002' as Id<'wageTaxSettlement'>,
        companyId: COMPANY,
        kind: 'ANNUAL',
        employeeId: STAYER.id,
        year: '2026',
      },
      { ...facts({ employeeNow: undefined, employeeAtBasis: undefined }), settlements: [] },
      AT,
    )

    expect(Result.isFailure(result) && result.failure).toMatchObject({ code: 'EMPLOYEE_NOT_FOUND' })
  })
})

describe('decideWageSettlementDeletion', () => {
  it('확정한 정산은 다시 열어야 지울 수 있습니다', () => {
    const created = create('ANNUAL')
    if (Result.isFailure(created)) throw created.failure
    const completed = decideWageSettlementDeletion({ ...created.success.settlement, status: 'COMPLETED' })

    expect(Result.isSuccess(decideWageSettlementDeletion(created.success.settlement))).toBe(true)
    expect(Result.isFailure(completed) && completed.failure).toMatchObject({
      code: 'WAGE_SETTLEMENT_TRANSITION_INVALID',
      action: 'DELETE',
    })
  })
})
