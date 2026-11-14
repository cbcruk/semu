import { Result } from 'effect'
import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { BUILT_IN_RATE_TABLES } from '../engine/rate-tables-2026.ts'
import { rateBasedSetting, testEmployee } from '../payroll-test-fixtures.ts'
import {
  decideLedgerCreation,
  decideLedgerDeletion,
  decideLedgerHeaderUpdate,
  decideLedgerRecalculation,
  decideLedgerTransition,
  decideRowAddition,
  decideRowDeletion,
  decideRowUpdate,
} from './payroll-ledger.aggregate.ts'
import type { LedgerCalculationFacts, LedgerDecisionContext } from './payroll-ledger.aggregate.ts'
import type { PayrollLedgerRecord } from './payroll-ledger.types.ts'

const COMPANY = 'cmp_01JBQ000000000000000000001' as Id<'company'>
const AT = '2026-11-14T01:00:00.000Z'
const CLIENT: LedgerDecisionContext = { at: AT, actor: { kind: 'CLIENT' } }
const AGENCY: LedgerDecisionContext = { at: AT, actor: { kind: 'AGENCY' } }
const CALCULATION: LedgerCalculationFacts = {
  rateTables: BUILT_IN_RATE_TABLES,
  setting: rateBasedSetting(),
  catalog: { paymentItems: new Map(), deductionItems: new Map() },
}
const NONE_FILED: ReadonlySet<string> = new Set()
const EMPLOYEE = testEmployee({ id: 'emp_01JBQ000000000000000000001' as Id<'employee'>, name: '김하나' })

/** 2026년 10월 정기 대장을 직원 한 명으로 만듭니다. */
function regularLedger(overrides: Partial<PayrollLedgerRecord> = {}): PayrollLedgerRecord {
  const created = decideLedgerCreation(
    { id: 'pld_01JBQ000000000000000000R01' as Id<'payrollLedger'>, companyId: COMPANY, attributionMonth: '2026-10' },
    { ledgers: [], filedPaymentMonths: NONE_FILED, ...CALCULATION, wageEarners: [EMPLOYEE] },
    AT,
  )
  if (Result.isFailure(created)) throw created.failure
  return { ...created.success.ledger, ...overrides }
}

describe('decideLedgerCreation', () => {
  it('귀속월의 첫 대장은 근로소득자로 행을 채운 정기 대장이고 바로 계산합니다', () => {
    const ledger = regularLedger()

    expect(ledger).toMatchObject({
      kind: 'REGULAR',
      status: 'DRAFT',
      title: '2026년 10월 급여',
      paymentDate: '2026-10-25',
      wagePeriod: { start: '2026-10-01', end: '2026-10-31' },
      calculatedAt: AT,
      version: 1,
    })
    expect(ledger.rows).toMatchObject([{ employeeId: EMPLOYEE.id, payeeName: '김하나', earnerId: null }])
    expect(ledger.rows[0]?.result).not.toBeNull()
  })

  it('지급월의 원천세가 신고됐으면 거부합니다', () => {
    const result = decideLedgerCreation(
      { id: 'pld_01JBQ000000000000000000R02' as Id<'payrollLedger'>, companyId: COMPANY, attributionMonth: '2026-10' },
      { ledgers: [], filedPaymentMonths: new Set(['2026-10']), ...CALCULATION, wageEarners: [] },
      AT,
    )

    expect(Result.isFailure(result) && result.failure).toMatchObject({
      code: 'WITHHOLDING_FILED',
      paymentMonth: '2026-10',
    })
  })

  it('정기 대장이 아직 입력 중이면 추가 대장을 막습니다', () => {
    const result = decideLedgerCreation(
      { id: 'pld_01JBQ000000000000000000A01' as Id<'payrollLedger'>, companyId: COMPANY, attributionMonth: '2026-10' },
      { ledgers: [regularLedger()], filedPaymentMonths: NONE_FILED, ...CALCULATION, wageEarners: [] },
      AT,
    )

    expect(Result.isFailure(result) && result.failure).toMatchObject({
      code: 'ADDITIONAL_LEDGER_BLOCKED',
      reason: 'REGULAR_LEDGER_NOT_SUBMITTED',
    })
  })
})

describe('decideLedgerTransition', () => {
  it('직접 마감하면 다시 계산하고, 지급월의 대장이 모두 마감되면 마감 이벤트를 냅니다', () => {
    const ledger = regularLedger()
    const result = decideLedgerTransition(
      ledger,
      'CLOSE',
      undefined,
      { ledgers: [ledger], filedPaymentMonths: NONE_FILED, ...CALCULATION },
      AGENCY,
    )

    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isFailure(result)) return
    expect(result.success.ledger).toMatchObject({ status: 'CLOSED', closedAt: AT, version: 2 })
    expect(result.success.events).toMatchObject([
      { type: 'payroll_pay_month.closed', companyId: COMPANY, paymentMonth: '2026-10', ledgerIds: [ledger.id] },
    ])
  })

  it('마감 해제는 사유를 남기고 지급월 마감이 풀렸다는 이벤트를 내며, 신고된 달이면 거부합니다', () => {
    const closed = regularLedger({ status: 'CLOSED', closedAt: AT })
    const reopened = decideLedgerTransition(
      closed,
      'REOPEN',
      '수당 누락',
      { ledgers: [closed], filedPaymentMonths: NONE_FILED, ...CALCULATION },
      AGENCY,
    )
    const filed = decideLedgerTransition(
      closed,
      'REOPEN',
      '수당 누락',
      { ledgers: [closed], filedPaymentMonths: new Set(['2026-10']), ...CALCULATION },
      AGENCY,
    )

    expect(Result.isSuccess(reopened) && reopened.success.ledger).toMatchObject({
      status: 'SUBMITTED',
      closedAt: null,
      reopenReason: '수당 누락',
    })
    expect(Result.isSuccess(reopened) && reopened.success.events).toMatchObject([
      { type: 'payroll_pay_month.reopened', paymentMonth: '2026-10' },
    ])
    expect(Result.isFailure(filed) && filed.failure).toMatchObject({ code: 'WITHHOLDING_FILED' })
  })
})

describe('입력 고치기', () => {
  it('고객은 제출된 대장을 고칠 수 없습니다', () => {
    const submitted = regularLedger({ status: 'SUBMITTED' })
    const result = decideRowDeletion(
      submitted,
      submitted.rows[0]!.id,
      { ledgers: [submitted], filedPaymentMonths: NONE_FILED },
      CLIENT,
    )

    expect(Result.isFailure(result) && result.failure).toMatchObject({
      code: 'PAYROLL_LEDGER_READ_ONLY',
      ledgerStatus: 'SUBMITTED',
    })
  })

  it('마감 전 대장은 신고된 달에서 지급일을 옮겨 나갈 수 있지만 신고된 달로 들일 수는 없습니다', () => {
    const ledger = regularLedger()
    const facts = { ledgers: [ledger], filedPaymentMonths: new Set(['2026-10']), ...CALCULATION }
    const out = decideLedgerHeaderUpdate(ledger, { paymentDate: '2026-11-05' }, facts, CLIENT)
    const into = decideLedgerHeaderUpdate(
      regularLedger({ paymentDate: '2026-11-05' }),
      { paymentDate: '2026-10-30' },
      facts,
      CLIENT,
    )

    expect(Result.isSuccess(out) && out.success.ledger).toMatchObject({ paymentDate: '2026-11-05', version: 2 })
    expect(Result.isFailure(into) && into.failure).toMatchObject({ code: 'WITHHOLDING_FILED', paymentMonth: '2026-10' })
  })

  it('행 입력의 소득 구분은 바꿀 수 없습니다', () => {
    const ledger = regularLedger()
    const result = decideRowUpdate(
      ledger,
      ledger.rows[0]!.id,
      { incomeType: 'WAGE_HOURLY', hourlyWage: 10_030 },
      { ledgers: [ledger], filedPaymentMonths: NONE_FILED, ...CALCULATION },
      CLIENT,
    )

    expect(Result.isFailure(result) && result.failure).toMatchObject({
      code: 'PAYROLL_ROW_PAYEE_INVALID',
      reason: 'INCOME_TYPE_CHANGED',
    })
  })
})

describe('decideRowAddition', () => {
  const facts = (ledger: PayrollLedgerRecord, ledgers = [ledger]) => ({
    ledgers,
    filedPaymentMonths: NONE_FILED,
    ...CALCULATION,
    employee: EMPLOYEE,
    earner: undefined,
  })

  it('같은 직원·귀속월의 근로 행은 하나뿐입니다', () => {
    const ledger = regularLedger()
    const result = decideRowAddition(
      ledger,
      { employeeId: EMPLOYEE.id, input: { incomeType: 'WAGE_MONTHLY', basePay: 1_000_000 } },
      facts(ledger),
      CLIENT,
    )

    expect(Result.isFailure(result) && result.failure).toMatchObject({
      code: 'WAGE_INCOME_DUPLICATED',
      ledgerId: ledger.id,
    })
  })

  it('명부에 없는 소득자와 직원·소득자를 함께 가리키는 행은 거부합니다', () => {
    const ledger = regularLedger()
    const missing = decideRowAddition(
      ledger,
      {
        earnerId: 'ern_01JBQ000000000000000000001' as Id<'earner'>,
        input: { incomeType: 'BUSINESS', payAmount: 1_000_000 },
      },
      facts(ledger),
      CLIENT,
    )
    const ambiguous = decideRowAddition(
      ledger,
      {
        employeeId: EMPLOYEE.id,
        earnerId: 'ern_01JBQ000000000000000000001' as Id<'earner'>,
        input: { incomeType: 'BUSINESS', payAmount: 1_000_000 },
      },
      facts(ledger),
      CLIENT,
    )

    expect(Result.isFailure(missing) && missing.failure).toMatchObject({ reason: 'EARNER_NOT_FOUND' })
    expect(Result.isFailure(ambiguous) && ambiguous.failure).toMatchObject({ reason: 'PAYEE_AMBIGUOUS' })
  })
})

describe('decideLedgerDeletion', () => {
  it('입력 중인 대장만 지우고, 추가 대장이 딸린 정기 대장은 지우지 않습니다', () => {
    const regular = regularLedger({ status: 'SUBMITTED' })
    const additional = regularLedger({
      id: 'pld_01JBQ000000000000000000A02' as Id<'payrollLedger'>,
      kind: 'ADDITIONAL',
    })
    const ledgers = [regular, additional]
    const submitted = decideLedgerDeletion(regular, { ledgers, filedPaymentMonths: NONE_FILED }, AGENCY)
    const withAdditional = decideLedgerDeletion(
      { ...regular, status: 'DRAFT' },
      { ledgers, filedPaymentMonths: NONE_FILED },
      AGENCY,
    )
    const draft = decideLedgerDeletion(additional, { ledgers, filedPaymentMonths: NONE_FILED }, CLIENT)

    expect(Result.isFailure(submitted) && submitted.failure).toMatchObject({
      code: 'PAYROLL_LEDGER_TRANSITION_INVALID',
      action: 'DELETE',
    })
    expect(Result.isFailure(withAdditional) && withAdditional.failure).toMatchObject({
      code: 'PAYROLL_LEDGER_HAS_ADDITIONAL',
    })
    expect(Result.isSuccess(draft) && draft.success.events).toEqual([])
  })
})

describe('decideLedgerRecalculation', () => {
  it('지금의 HR 정보로 행 사본을 갱신하고, 없어진 직원의 행은 그대로 둡니다', () => {
    const ledger = regularLedger()
    const renamed = decideLedgerRecalculation(
      ledger,
      {
        ledgers: [ledger],
        filedPaymentMonths: NONE_FILED,
        ...CALCULATION,
        employees: new Map([[EMPLOYEE.id, { ...EMPLOYEE, name: '김하나(개명)' }]]),
        earners: new Map(),
      },
      CLIENT,
    )
    const gone = decideLedgerRecalculation(
      ledger,
      {
        ledgers: [ledger],
        filedPaymentMonths: NONE_FILED,
        ...CALCULATION,
        employees: new Map(),
        earners: new Map(),
      },
      CLIENT,
    )

    expect(Result.isSuccess(renamed) && renamed.success.ledger.rows[0]?.payeeName).toBe('김하나(개명)')
    expect(Result.isSuccess(gone) && gone.success.ledger.rows[0]?.payeeName).toBe('김하나')
    expect(Result.isSuccess(gone) && gone.success.ledger.version).toBe(2)
  })
})
