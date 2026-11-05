import { HttpApi } from 'effect/http-api'
import { LaborCostReportsGroup } from './labor-cost/labor-cost-reports.api.ts'
import { PayrollLedgerApprovalsGroup, PayrollLedgersGroup } from './ledgers/payroll-ledgers.api.ts'
import { PayslipsGroup } from './payslips/payslips.api.ts'
import { PayrollCalculatorGroup, RateTablesGroup } from './rate-tables/rate-tables.api.ts'
import { PayrollSettingsGroup } from './settings/payroll-settings.api.ts'
import { SeveranceSettlementsGroup } from './severance/severance-settlements.api.ts'

/**
 * 급여 계산 엔진·기준표·급여 설정·급여대장·명세서·퇴직금·인건비 컨텍스트의 HTTP 계약입니다. 루트 `Api`가 `addHttpApi`로 합칩니다.
 */
export const PayrollApi = HttpApi.make('payroll')
  .add(RateTablesGroup)
  .add(PayrollCalculatorGroup)
  .add(PayrollSettingsGroup)
  .add(PayrollLedgersGroup)
  .add(PayrollLedgerApprovalsGroup)
  .add(PayslipsGroup)
  .add(SeveranceSettlementsGroup)
  .add(LaborCostReportsGroup)
