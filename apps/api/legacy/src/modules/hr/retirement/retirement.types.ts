import type { z } from 'zod'
import type { retirementBody } from './retirement.schema'

/** Parsed body of `PUT retirement-info`. */
export type RetirementInput = z.infer<typeof retirementBody>

/** Retirement benefit scheme: severance pay or a DB/DC pension. */
export type RetirementBenefitType = 'grant' | 'pension_db' | 'pension_dc'

/** Severance settlement progress, written by payroll. */
export type SeveranceSettlementStatus = 'in_progress' | 'completed' | 'excluded'

/** A row of `employee_retirement_infos`. */
export interface RetirementInfoRow {
  company_id: string
  employee_id: number
  retirement_benefit_type: RetirementBenefitType
  has_interim_settlement: 0 | 1
  interim_settlement_date: string | null
  interim_settlement_reason: string | null
  leave_date: string | null
  leaving_reason: string | null
  leaving_detail_reason: string | null
  severance_amount: number | null
  severance_settlement_status: SeveranceSettlementStatus | null
  updated_at: string
}

/** Values written by the retirement form. */
export type RetirementInfoWrite = Omit<RetirementInfoRow, 'company_id' | 'employee_id' | 'severance_settlement_status' | 'updated_at'>

/** A leaving reason with its detail reasons (고용보험 상실사유). */
export interface LeavingReason {
  code: string
  name: string
  details: { code: string; name: string }[]
}
