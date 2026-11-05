import type { IncomeTaxMethod, PremiumMultipliers } from '../engine/engine.types.ts'
import type { PaymentMonthRule } from '../ledgers/ledger-rules.ts'
import type { LedgerWorkflow } from '../ledgers/ledger-status.types.ts'

/** 저장된 회사 급여 설정입니다. 응답 스키마 `PayrollSetting`과 같은 모양입니다. */
export interface PayrollSettingRecord {
  wagePeriodStartDay: number
  paymentMonth: PaymentMonthRule
  paymentDay: number
  underFiveEmployees: boolean
  multipliers: PremiumMultipliers
  deductionMethods: {
    nationalPension: 'RATE' | 'NOTICE'
    healthInsurance: 'RATE' | 'NOTICE'
    employmentInsurance: 'RATE' | 'NOTICE'
    incomeTax: IncomeTaxMethod
  }
  workflow: LedgerWorkflow
  version: number
  updatedAt: string | null
}
