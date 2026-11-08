import type { LedgerIncomeKind } from '../ledgers/pay-month.types.ts'

/** 소득 구분별 금액입니다. */
export type AmountsByKind = Record<'wage' | 'daily' | 'business' | 'other', number>

/** 인건비 보고서의 한 달입니다. */
export interface LaborCostMonth {
  month: string
  /** 소득 구분별 세전 지급 총액입니다. */
  amounts: AmountsByKind
  total: number
  /** 사업주 부담 4대보험입니다. */
  employerInsurance: number
  totalWithEmployerInsurance: number
  /** 소득 구분별 인원입니다. 직원 ID(없으면 이름) 기준으로 중복 없이 셉니다. */
  headcount: AmountsByKind
  /** HR의 재직·입사·퇴사 인원입니다. */
  employment: { employed: number; joined: number; left: number }
}

/** 한 해의 인건비 보고서입니다. Bookkeeping의 인건비 화면과 결산이 씁니다. */
export interface LaborCostReport {
  year: number
  hasData: boolean
  months: LaborCostMonth[]
  totals: Omit<LaborCostMonth, 'month' | 'employment'>
  /** 반영된 계산 중 가장 늦은 계산 시각입니다. */
  updatedAt: string | null
}

/** 보고서 집계 입력 행입니다. 계산 확정 이후 대장의 행만 넣습니다. */
export interface LaborCostRow {
  attributionMonth: string
  incomeKind: LedgerIncomeKind
  payeeKey: string
  grossPay: number
  employerInsurance: number
  calculatedAt: string | null
}
