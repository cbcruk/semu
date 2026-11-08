import type {
  InvoiceClassCode,
  InvoiceKindCode,
  StatementItem,
  StatementProblem,
  TaxInvoiceRecord,
} from './sales-transaction.types.ts'

/**
 * 거래명세서 본문을 검사해 문제를 모두 돌려줍니다. 비어 있으면 통과입니다.
 *
 * - 위수탁(`03`·`04`)과 수정 발행(`02`·`04`)은 지원하지 않습니다
 * - 공급가액 합계 = 품목 공급가액 합, 세액 합계 = 품목 세액 합, 합계 = 공급가액 + 세액
 * - 계산서(면세, `03`)와 영세율(`02`)은 세액이 0이어야 합니다
 */
export function statementProblems(statement: {
  invoiceClassCode: InvoiceClassCode
  invoiceKindCode: InvoiceKindCode
  items: ReadonlyArray<Pick<StatementItem, 'supplyAmount' | 'vatAmount'>>
  supplyAmount: number
  vatAmount: number
  totalAmount: number
}): StatementProblem[] {
  const problems: StatementProblem[] = []
  if (statement.invoiceKindCode === '03' || statement.invoiceKindCode === '04') {
    problems.push({ code: 'UNSUPPORTED', field: 'invoiceKindCode' })
  }
  if (statement.invoiceClassCode === '02' || statement.invoiceClassCode === '04') {
    problems.push({ code: 'UNSUPPORTED', field: 'invoiceClassCode' })
  }
  const 품목공급가액합 = statement.items.reduce((sum, item) => sum + item.supplyAmount, 0)
  const 품목세액합 = statement.items.reduce((sum, item) => sum + item.vatAmount, 0)
  if (품목공급가액합 !== statement.supplyAmount) problems.push({ code: 'AMOUNT_MISMATCH', field: 'supplyAmount' })
  const 계산서또는영세율인가 = statement.invoiceClassCode === '03' || statement.invoiceKindCode === '02'
  if (품목세액합 !== statement.vatAmount || (계산서또는영세율인가 && statement.vatAmount !== 0)) {
    problems.push({ code: 'AMOUNT_MISMATCH', field: 'vatAmount' })
  }
  if (statement.totalAmount !== statement.supplyAmount + statement.vatAmount) {
    problems.push({ code: 'AMOUNT_MISMATCH', field: 'totalAmount' })
  }
  return problems
}

/** 거래명세서의 발급 상태입니다. 발급 완료 건이 하나라도 있으면 `ISSUED`입니다. */
export function issueStatusOf(invoices: ReadonlyArray<Pick<TaxInvoiceRecord, 'status'>>): 'ISSUE_REQUIRED' | 'ISSUED' {
  return invoices.some((invoice) => invoice.status === 'ISSUED') ? 'ISSUED' : 'ISSUE_REQUIRED'
}

/**
 * 거래명세서를 고치거나 지우거나 다시 발급할 수 있는지입니다. 발급한 뒤에는 막습니다(수정 발행 미지원).
 * 발급 중인 건이 있어도 다시 발급할 수 없습니다.
 */
export function statementLock(
  invoices: ReadonlyArray<Pick<TaxInvoiceRecord, 'status'>>,
): 'EDITABLE' | 'ISSUED' | 'ISSUING' {
  if (invoices.some((invoice) => invoice.status === 'ISSUED')) return 'ISSUED'
  if (invoices.some((invoice) => invoice.status === 'ISSUING')) return 'ISSUING'
  return 'EDITABLE'
}

/** 목록에 보이는 품목 요약입니다. `첫 품목 외 N건`입니다. */
export function itemSummary(items: ReadonlyArray<Pick<StatementItem, 'name'>>): string {
  const 첫품목명 = items[0]?.name ?? ''
  return items.length > 1 ? `${첫품목명} 외 ${items.length - 1}건` : 첫품목명
}
