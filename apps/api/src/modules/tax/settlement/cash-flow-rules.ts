import type {
  CashAccount,
  CashFlowInputMonth,
  CashFlowMonth,
  CashFlowUpload,
  FiscalPeriod,
  SettlementSnapshotViolation,
} from './settlement-report.types.ts'
import { validateSnapshotMonths } from './settlement-rules.ts'

/** 현금성 계정입니다. 자금 흐름 표의 순서입니다. */
export const CASH_ACCOUNTS: ReadonlyArray<CashAccount> = [
  'CASH',
  'CHECKING_DEPOSIT',
  'ORDINARY_DEPOSIT',
  'OTHER_DEPOSITS',
]

/**
 * 자금 흐름 스냅샷 업로드가 맞는지 봅니다. 맞으면 `undefined`, 아니면 처음 걸린 위반 하나입니다.
 *
 * - 결산 기준일과 월 목록은 {@link validateSnapshotMonths}가 봅니다
 * - 유입과 유출은 0 이상입니다. 방향은 필드가 정하므로 부호를 쓰지 않습니다
 * - 계정마다 월말 잔액 = 전월 말 잔액(첫 달은 기초 잔액) + 유입 − 유출입니다. 원장에서 뽑은 숫자라 어긋나면 업로드가 잘못된 것입니다
 *
 * 잔액의 부호는 보지 않습니다. 당좌예금은 당좌차월 약정이 있으면 음수일 수 있습니다.
 *
 * @example
 * ```ts
 * validateCashFlowUpload(upload, fiscalPeriod(2026, 12), '2026-11-11')
 * // { reason: 'CASH_BALANCE_MISMATCH', field: 'months[1].accounts.ORDINARY_DEPOSIT.closingBalance' }
 * ```
 */
export function validateCashFlowUpload(
  upload: CashFlowUpload,
  period: FiscalPeriod,
  today: string,
): SettlementSnapshotViolation | undefined {
  const periodViolation = validateSnapshotMonths(upload, period, today)
  if (periodViolation !== undefined) return periodViolation

  const 월순 = upload.months
    .map((month, index) => ({ month, index }))
    .toSorted((a, b) => a.month.month.localeCompare(b.month.month))
  for (const account of CASH_ACCOUNTS) {
    let 전월잔액 = upload.openingBalances[account]
    for (const { month, index } of 월순) {
      const 값 = month.accounts[account]
      const field = `months[${index}].accounts.${account}`
      if (값.inflow < 0) return { reason: 'CASH_AMOUNT_NEGATIVE', field: `${field}.inflow` }
      if (값.outflow < 0) return { reason: 'CASH_AMOUNT_NEGATIVE', field: `${field}.outflow` }
      if (값.closingBalance !== 전월잔액 + 값.inflow - 값.outflow) {
        return { reason: 'CASH_BALANCE_MISMATCH', field: `${field}.closingBalance` }
      }
      전월잔액 = 값.closingBalance
    }
  }
  return undefined
}

/**
 * 한 달 자금 흐름에 계정 합계를 채웁니다.
 *
 * ```text
 * 유입 = Σ 계정 유입,  유출 = Σ 계정 유출
 * 순유입 = 유입 − 유출
 * 보유자금 = Σ 계정 월말 잔액
 * ```
 */
export function deriveCashFlowMonth(input: CashFlowInputMonth): CashFlowMonth {
  const 합 = (pick: (account: CashAccount) => number) => CASH_ACCOUNTS.reduce((sum, account) => sum + pick(account), 0)
  const inflow = 합((account) => input.accounts[account].inflow)
  const outflow = 합((account) => input.accounts[account].outflow)
  return {
    month: input.month,
    accounts: input.accounts,
    inflow,
    outflow,
    netInflow: inflow - outflow,
    fundsHeld: 합((account) => input.accounts[account].closingBalance),
  }
}
