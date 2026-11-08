import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { SeveranceSettlementRecord, SeveranceStatus } from './severance-settlement.types.ts'
import {
  severanceMonthsTouched,
  severanceWithholdingMonthsChanged,
  severanceWithholdingPaidIn,
} from './severance-withholding.ts'

function settlement(
  employeeId: string,
  status: SeveranceStatus,
  paymentDate: string | undefined,
  amounts = { severancePay: 8_321_917, retirementIncomeTax: 79_720, localIncomeTax: 7_970 },
): SeveranceSettlementRecord {
  return {
    employeeId: employeeId as Id<'employee'>,
    status,
    ...(paymentDate === undefined ? {} : { paymentDate }),
    result: { eligible: amounts.severancePay > 0, ...amounts },
  } as unknown as SeveranceSettlementRecord
}

describe('severanceWithholdingPaidIn', () => {
  it('지급일이 그 달인 완료 정산을 퇴직소득 한 줄로 더합니다', () => {
    const settlements = [
      settlement('emp_a', 'COMPLETED', '2026-10-31'),
      settlement('emp_b', 'COMPLETED', '2026-10-05', {
        severancePay: 5_000_000,
        retirementIncomeTax: 20_000,
        localIncomeTax: 2_000,
      }),
    ]

    expect(severanceWithholdingPaidIn(settlements, '2026-10')).toEqual({
      incomeKind: 'RETIREMENT',
      otherIncomeCategory: null,
      headcount: 2,
      grossPay: 13_321_917,
      taxablePay: 13_321_917,
      incomeTax: 99_720,
      localIncomeTax: 9_970,
    })
  })

  it('계산됨·제외 정산, 다른 달 정산, 지급일이 없는 정산, 퇴직금이 0원인 정산은 넣지 않습니다', () => {
    const settlements = [
      settlement('emp_a', 'CALCULATED', '2026-10-31'),
      settlement('emp_b', 'EXCLUDED', '2026-10-31'),
      settlement('emp_c', 'COMPLETED', '2026-11-10'),
      settlement('emp_d', 'COMPLETED', undefined),
      settlement('emp_e', 'COMPLETED', '2026-10-31', { severancePay: 0, retirementIncomeTax: 0, localIncomeTax: 0 }),
    ]

    expect(severanceWithholdingPaidIn(settlements, '2026-10')).toBeNull()
  })
})

describe('severanceWithholdingMonthsChanged', () => {
  it('완료하면 지급월, 다시 열면 원래 지급월의 합계가 바뀝니다', () => {
    const calculated = settlement('emp_a', 'CALCULATED', '2026-10-31')
    const completed = settlement('emp_a', 'COMPLETED', '2026-10-31')

    expect(severanceWithholdingMonthsChanged(calculated, completed)).toEqual(['2026-10'])
    expect(severanceWithholdingMonthsChanged(completed, calculated)).toEqual(['2026-10'])
  })

  it('완료한 채 지급일을 다른 달로 옮기면 두 달 모두 바뀝니다', () => {
    expect(
      severanceWithholdingMonthsChanged(
        settlement('emp_a', 'COMPLETED', '2026-11-10'),
        settlement('emp_a', 'COMPLETED', '2026-10-31'),
      ),
    ).toEqual(['2026-10', '2026-11'])
  })

  it('계산됨 정산의 생성·지급일 이동·제외는 합계를 바꾸지 않습니다', () => {
    expect(severanceWithholdingMonthsChanged(undefined, settlement('emp_a', 'CALCULATED', '2026-10-31'))).toEqual([])
    expect(
      severanceWithholdingMonthsChanged(
        settlement('emp_a', 'CALCULATED', '2026-10-31'),
        settlement('emp_a', 'CALCULATED', '2026-11-10'),
      ),
    ).toEqual([])
    expect(
      severanceWithholdingMonthsChanged(
        settlement('emp_a', 'CALCULATED', '2026-10-31'),
        settlement('emp_a', 'EXCLUDED', '2026-10-31'),
      ),
    ).toEqual([])
  })
})

describe('severanceMonthsTouched', () => {
  it('합계가 바뀐 달에 더해 계산됨 정산의 지급일을 옮기기 전후 두 달을 잠금 대상으로 봅니다', () => {
    expect(
      severanceMonthsTouched(
        settlement('emp_a', 'CALCULATED', '2026-10-31'),
        settlement('emp_a', 'CALCULATED', '2026-11-10'),
      ),
    ).toEqual(['2026-10', '2026-11'])
  })

  it('지급일을 새로 정하거나 지우면 그 달 하나, 같은 달 안의 변경은 완료·다시 열기만 봅니다', () => {
    expect(severanceMonthsTouched(undefined, settlement('emp_a', 'CALCULATED', '2026-10-31'))).toEqual(['2026-10'])
    expect(
      severanceMonthsTouched(
        settlement('emp_a', 'CALCULATED', '2026-10-31'),
        settlement('emp_a', 'CALCULATED', undefined),
      ),
    ).toEqual(['2026-10'])
    expect(
      severanceMonthsTouched(
        settlement('emp_a', 'CALCULATED', '2026-10-05'),
        settlement('emp_a', 'CALCULATED', '2026-10-31'),
      ),
    ).toEqual([])
    expect(
      severanceMonthsTouched(
        settlement('emp_a', 'CALCULATED', undefined),
        settlement('emp_a', 'COMPLETED', '2026-10-31'),
      ),
    ).toEqual(['2026-10'])
  })
})
