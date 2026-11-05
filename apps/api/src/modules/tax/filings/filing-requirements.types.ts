import type { RequirementResponse } from '../tax.types.ts'

/**
 * 제출 자료 항목 코드입니다. 화면 문구는 클라이언트가 코드로 고릅니다.
 *
 * 부가세: `PG_ONLINE_SALES`(PG사·온라인 매출), `EXPORT_FX`(국외 수출 자료), `PAPER_TAX_INVOICE`(종이 세금계산서·계산서),
 * `SIMPLE_RECEIPT`(간이영수증), `ENDING_INVENTORY`(월말 재고금액), `DEPOSIT_FUND_ACCOUNTS`(예·적금, 펀드 계좌).
 * 원천세: `PAYROLL_LEDGER_CLOSED`(급여대장 마감분, 자동 연계), `BUSINESS_INCOME`, `OTHER_INCOME`, `DAILY_WAGE`,
 * `RETIREMENT_INCOME`, `INTEREST_DIVIDEND`, `UNREFLECTED_BONUS`.
 */
export type RequirementCode =
  | 'PG_ONLINE_SALES'
  | 'EXPORT_FX'
  | 'PAPER_TAX_INVOICE'
  | 'SIMPLE_RECEIPT'
  | 'ENDING_INVENTORY'
  | 'DEPOSIT_FUND_ACCOUNTS'
  | 'PAYROLL_LEDGER_CLOSED'
  | 'BUSINESS_INCOME'
  | 'OTHER_INCOME'
  | 'DAILY_WAGE'
  | 'RETIREMENT_INCOME'
  | 'INTEREST_DIVIDEND'
  | 'UNREFLECTED_BONUS'

/** 신고 건을 만들 때 복사하는 체크리스트 항목입니다. */
export interface RequirementTemplate {
  code: RequirementCode
  /** 다른 컨텍스트의 사실로 응답이 정해지는 항목입니다. 고객이 고칠 수 없고 제출 검사에서 뺍니다. */
  autoLinked: boolean
}

/** 고객이 항목에 직접 고를 수 있는 응답입니다. `PROVIDED`는 파일을 붙이면 서버가 정합니다. */
export type RequirementAnswer = Extract<RequirementResponse, 'PENDING' | 'NOT_APPLICABLE'>

/** 응답을 정할 때 보는 항목의 현재 상태입니다. */
export interface RequirementState {
  autoLinked: boolean
  fileCount: number
}

/** 항목 응답을 거부할 때 돌려주는 오류 코드입니다. */
export type RequirementErrorCode = 'REQUIREMENT_AUTO_LINKED' | 'REQUIREMENT_HAS_FILES'

/** 항목에 고객 응답을 적용해 본 결과입니다. */
export type RequirementAnswerResult =
  { ok: true; response: RequirementResponse } | { ok: false; code: RequirementErrorCode }

/** 신고 기간에 지급한 급여대장의 마감 현황입니다. Payroll이 포트로 알려 줍니다. */
export interface PayrollLedgerSummary {
  ledgerCount: number
  closedCount: number
}
