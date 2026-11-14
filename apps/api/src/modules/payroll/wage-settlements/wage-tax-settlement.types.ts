import type { Id } from '../../../shared/ids/ids.types.ts'

/**
 * 근로소득 정산 종류입니다. 원천징수이행상황신고서의 줄이 다릅니다.
 *
 * - `MID_YEAR`: 중도퇴사자 연말정산(A02). 그해 중간에 퇴사한 직원의 1월부터 퇴사월까지 근로소득을 퇴사할 때 정산합니다
 * - `ANNUAL`: 연말정산(A04). 12월 31일에 재직한 직원의 그해 근로소득을 다음 해 2월 급여 때 정산합니다
 */
export type WageSettlementKind = 'MID_YEAR' | 'ANNUAL'

/** 근로소득 정산 상태입니다. 계산됨과 확정(원천세 합계에 들어감)입니다. */
export type WageSettlementStatus = 'CALCULATED' | 'COMPLETED'

/** 근로자가 소득·세액공제 신고서로 낸 금액 중 엔진이 따로 계산하지 않는 것입니다. */
export interface WageSettlementInput {
  /** 그 밖의 소득공제 합계(신용카드 등 조세특례제한법 소득공제)입니다. 표준세액공제를 받아도 뺍니다. */
  otherIncomeDeductions?: number
  /** 그 밖의 세액공제 합계(자녀, 연금계좌, 보험료·의료비·교육비·기부금, 월세 등)입니다. */
  otherTaxCredits?: number
}

/** 그해 마감된 급여대장에서 모은 그 직원의 근로소득입니다. */
export interface WageYearTotals {
  /** 귀속월(`YYYY-MM`)입니다. 앞에서부터입니다. */
  months: string[]
  /** 총지급액(비과세 포함)입니다. */
  grossPay: number
  /** 총급여(비과세 뺌)입니다. */
  taxablePay: number
  /** 근로자 부담 국민연금입니다. 연금보험료공제입니다. */
  nationalPension: number
  /** 근로자 부담 건강보험료와 장기요양보험료입니다. */
  healthInsurance: number
  /** 근로자 부담 고용보험료입니다. */
  employmentInsurance: number
  /** 이미 원천징수한 소득세(기납부세액)입니다. */
  withheldIncomeTax: number
  /** 이미 원천징수한 지방소득세입니다. */
  withheldLocalIncomeTax: number
}

/** 근로소득 정산 결과입니다. 원 단위입니다. */
export interface WageSettlementResult {
  totalPay: number
  earnedIncomeDeduction: number
  earnedIncome: number
  personalDeduction: number
  pensionDeduction: number
  /** 건강·장기요양·고용보험료 소득공제(특별소득공제)입니다. 표준세액공제를 고르면 0입니다. */
  insuranceDeduction: number
  otherIncomeDeductions: number
  taxBase: number
  calculatedTax: number
  earnedIncomeCredit: number
  /** 표준세액공제입니다. 특별공제를 고르면 0입니다. */
  standardTaxCredit: number
  otherTaxCredits: number
  /** 특별공제(`ITEMIZED`)와 표준세액공제(`STANDARD`) 중 결정세액이 적은 쪽입니다. */
  deductionMethod: 'ITEMIZED' | 'STANDARD'
  determinedTax: number
  determinedLocalIncomeTax: number
  withheldIncomeTax: number
  withheldLocalIncomeTax: number
  /** 차감징수세액입니다. 결정세액 − 기납부세액이고, 음수면 돌려줄 세액(환급)입니다. */
  balanceIncomeTax: number
  balanceLocalIncomeTax: number
}

/** 근로소득 정산 한 건입니다. 직원 한 명의 한 해 한 종류입니다. */
export interface WageTaxSettlementRecord {
  id: Id<'wageTaxSettlement'>
  companyId: Id<'company'>
  employeeId: Id<'employee'>
  employeeName: string
  kind: WageSettlementKind
  /** 정산하는 과세연도(`YYYY`)입니다. */
  year: string
  joinDate: string
  leaveDate: string | null
  /** 본인을 포함한 공제대상가족 수입니다. 퇴사일(연말정산은 12월 31일)의 HR 값입니다. */
  dependants: number
  input: WageSettlementInput
  totals: WageYearTotals
  result: WageSettlementResult
  /** 계산에 쓴 기준표(그해 마지막 귀속월)입니다. */
  rateTable: string
  /** 정산 세액을 지급·징수한 날입니다. 이 날의 달 원천세에 A02·A04로 들어갑니다. 확정할 때 없으면 기본값을 채웁니다. */
  paymentDate?: string
  status: WageSettlementStatus
  version: number
  createdAt: string
  updatedAt: string
}
