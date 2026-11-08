import { DEFAULT_OTHER_INCOME_CODE, PERSONAL_SERVICE_OTHER_INCOME_CODES } from '../rate-tables/reference-codes.ts'
import type { PayrollRowInputValue } from '../rows/payroll-row-input.ts'
import type { SeveranceSettlementRecord } from '../severance/severance-settlement.types.ts'
import { severanceWithholdingPaidIn } from '../severance/severance-withholding.ts'
import type {
  LedgerIncomeKind,
  OtherIncomeCategory,
  WithholdingIncomeKind,
  WithholdingSummaryLine,
} from './pay-month.types.ts'
import { paymentMonthOf } from './ledger-rules.ts'
import type { PayrollLedgerRecord } from './payroll-ledger.types.ts'

/** 지급월의 대장 마감 상태가 바뀐 결과입니다. */
export type PayMonthChange = { kind: 'CLOSED'; paymentMonth: string } | { kind: 'REOPENED'; paymentMonth: string }

/** 지급월에 지급일이 있는 대장이 하나 이상이고 모두 `CLOSED`인지입니다. */
export function isPayMonthClosed(ledgers: readonly PayrollLedgerRecord[], paymentMonth: string): boolean {
  const 지급월대장 = ledgers.filter((ledger) => paymentMonthOf(ledger.paymentDate) === paymentMonth)
  return 지급월대장.length > 0 && 지급월대장.every((ledger) => ledger.status === 'CLOSED')
}

/**
 * 변경 전후 대장 목록을 비교해 지급월 마감 상태가 바뀐 달을 찾습니다. 모두 마감이 되면 `CLOSED`,
 * 모두 마감이었다가 아니게 되면(마감 해제·새 대장·지급일 이동·삭제로 빈 달) `REOPENED`입니다.
 */
export function payMonthChanges(
  before: readonly PayrollLedgerRecord[],
  after: readonly PayrollLedgerRecord[],
): PayMonthChange[] {
  const 지급월목록 = new Set([...before, ...after].map((ledger) => paymentMonthOf(ledger.paymentDate)))
  const 지급월변경: PayMonthChange[] = []
  for (const paymentMonth of [...지급월목록].sort()) {
    const 이전마감임 = isPayMonthClosed(before, paymentMonth)
    const 이후마감임 = isPayMonthClosed(after, paymentMonth)
    if (!이전마감임 && 이후마감임) 지급월변경.push({ kind: 'CLOSED', paymentMonth })
    if (이전마감임 && !이후마감임) 지급월변경.push({ kind: 'REOPENED', paymentMonth })
  }
  return 지급월변경
}

/**
 * 대장 머리(제목·지급일) 변경이 건드리는 지급월을 앞에서부터 돌려줍니다. 원천세 신고 잠금(`WithholdingFilingLock`)은 이 달들을 봅니다.
 *
 * 지급일을 다른 달로 옮기면 옮겨 갈 달이 듭니다. 그래서 신고된 달에는 대장이 새로 들어가지 않습니다. 원래 달은 마감한 대장일 때만
 * 듭니다. 마감한 대장만 그 달 원천세 합계에 들어 있어(`withholdingTotalsPaidIn`) 빼내면 신고와 어긋나기 때문입니다. 마감 전
 * 대장은 합계에 들지 않으므로 신고된 달에서 빼내도 신고와 어긋나지 않습니다(2026-11-08 결정). 마감한 대장은 입력을 고칠 수
 * 없어(`INPUT_EDITORS`) 다시 열어야 옮길 수 있고, 다시 열기가 잠기므로 여전히 빼낼 수 없습니다.
 *
 * 제목만 고치거나 같은 달 안에서 지급일을 바꾸면 그 달입니다. 신고된 달의 대장 편집은 행 편집처럼 막습니다.
 * 퇴직금 정산의 `severanceMonthsTouched`와 달리 같은 달 안의 변경도 잠금 대상입니다.
 */
export function ledgerMonthsTouched(before: PayrollLedgerRecord, after: PayrollLedgerRecord): string[] {
  const 이전지급월 = paymentMonthOf(before.paymentDate)
  const 이후지급월 = paymentMonthOf(after.paymentDate)
  if (이전지급월 === 이후지급월) return [이전지급월]
  const 빼내는달 = before.status === 'CLOSED' ? [이전지급월] : []
  return [...빼내는달, 이후지급월].toSorted()
}

/** 행의 소득 구분을 원천세 집계 구분으로 바꿉니다. */
export function withholdingKindOf(incomeType: string): LedgerIncomeKind {
  if (incomeType === 'DAILY' || incomeType === 'BUSINESS' || incomeType === 'OTHER') return incomeType
  return 'WAGE'
}

/**
 * 지급월(`YYYY-MM`)에 지급일이 있는 **마감된** 대장들과 **완료한** 퇴직금 정산의 원천세 집계입니다. Tax의 원천세 신고서 줄이 씁니다.
 *
 * 마감 전 대장의 금액은 아직 바뀔 수 있어 넣지 않습니다. 그 달이 모두 마감됐는지는 {@link isPayMonthClosed}로 따로 봅니다.
 * 퇴직소득(`RETIREMENT`)은 대장 행이 아니라 지급일이 그 달인 완료 정산에서 옵니다(`severanceWithholdingPaidIn`). 대장이 없는
 * 달에도 정산이 있으면 그 줄 하나가 나옵니다.
 */
export function withholdingTotalsPaidIn(
  ledgers: readonly PayrollLedgerRecord[],
  paymentMonth: string,
  settlements: readonly SeveranceSettlementRecord[] = [],
): WithholdingSummaryLine[] {
  const 마감된지급월대장 = ledgers.filter(
    (ledger) => ledger.status === 'CLOSED' && paymentMonthOf(ledger.paymentDate) === paymentMonth,
  )
  const 퇴직소득 = severanceWithholdingPaidIn(settlements, paymentMonth)
  return withholdingSummary(마감된지급월대장, 퇴직소득 === null ? [] : [퇴직소득])
}

/**
 * 기타소득 행의 구분입니다. 지급사유가 소득세법 제21조제1항제19호의 인적용역(`76`·`79`)이면 `PERSONAL_SERVICE`입니다.
 * 지급사유가 없으면 계산과 같은 기본값(`76`)으로 봅니다. 기타소득이 아닌 행은 `null`입니다.
 */
export function otherIncomeCategoryOf(input: PayrollRowInputValue): OtherIncomeCategory | null {
  if (input.incomeType !== 'OTHER') return null
  const 지급사유코드 = input.otherIncomeCode ?? DEFAULT_OTHER_INCOME_CODE
  return PERSONAL_SERVICE_OTHER_INCOME_CODES.includes(지급사유코드) ? 'PERSONAL_SERVICE' : 'GENERAL'
}

/**
 * 지급월 대장들의 원천세 집계에 대장 밖의 줄(퇴직소득)을 더합니다. 인원은 직원 ID(없으면 이름) 기준으로 중복 없이 셉니다.
 * 기타소득은 인적용역과 그 밖으로 나눕니다. 행이 없는 구분은 빼고, 순서는 근로·일용·퇴직·사업·기타(인적용역, 그 밖)입니다.
 */
function withholdingSummary(
  ledgers: readonly PayrollLedgerRecord[],
  nonLedgerLines: readonly WithholdingSummaryLine[],
): WithholdingSummaryLine[] {
  const 집계순서: ReadonlyArray<[WithholdingIncomeKind, OtherIncomeCategory | null]> = [
    ['WAGE', null],
    ['DAILY', null],
    ['RETIREMENT', null],
    ['BUSINESS', null],
    ['OTHER', 'PERSONAL_SERVICE'],
    ['OTHER', 'GENERAL'],
  ]
  const 구분별합계 = new Map<string, WithholdingSummaryLine & { people: Set<string> }>()
  for (const row of ledgers.flatMap((ledger) => ledger.rows)) {
    if (row.result === null) continue
    const 소득구분 = withholdingKindOf(row.input.incomeType)
    const 기타소득구분 = otherIncomeCategoryOf(row.input)
    const line = 구분별합계.get(`${소득구분}:${기타소득구분}`) ?? {
      incomeKind: 소득구분,
      otherIncomeCategory: 기타소득구분,
      headcount: 0,
      grossPay: 0,
      taxablePay: 0,
      incomeTax: 0,
      localIncomeTax: 0,
      people: new Set<string>(),
    }
    line.people.add(row.employeeId ?? `name:${row.payeeName}`)
    line.grossPay += row.result.grossPay
    line.taxablePay += row.result.taxablePay
    line.incomeTax += row.result.incomeTax
    line.localIncomeTax += row.result.localIncomeTax
    구분별합계.set(`${소득구분}:${기타소득구분}`, line)
  }
  const 줄목록 = new Map<string, WithholdingSummaryLine>(
    [...구분별합계].map(([key, { people, ...rest }]) => [key, { ...rest, headcount: people.size }]),
  )
  for (const line of nonLedgerLines) 줄목록.set(`${line.incomeKind}:${line.otherIncomeCategory}`, line)
  return 집계순서.flatMap(([소득구분, 기타소득구분]) => {
    const line = 줄목록.get(`${소득구분}:${기타소득구분}`)
    return line === undefined ? [] : [line]
  })
}
