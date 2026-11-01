/**
 * Pure payroll calculation engine: social insurance, withholding taxes, working-time pay and severance.
 *
 * Nothing here touches the database. Resolve a {@linkcode PayrollRateTable}
 * for the attribution month, then call {@linkcode calculatePayrollRow}.
 *
 * @example Calculating a business income payment
 * ```ts
 * import { calculatePayrollRow, PAYROLL_RATE_TABLES, resolveRateTable } from './index'
 *
 * const rates = resolveRateTable(PAYROLL_RATE_TABLES, '2026-11')
 * calculatePayrollRow({ incomeType: 'business', attributionMonth: '2026-11', payAmount: 1_000_000 }, rates).netPay // 967_000
 * ```
 *
 * @module
 */
export type * from './engine.types'
export type * from './rate-table.types'
export { calculateBusinessRow, calculateDailyWorkerRow, calculateOtherIncomeRow, calculatePayrollRow, calculateWageRow } from './payroll-row'
export { PAYROLL_RATE_TABLES, RATES_2026_01, RATES_2026_07 } from './rate-table-2026'
export { isYearMonth, resolveRateTable, unverifiedRatePaths, yearMonthFromTargetDate } from './rate-table'
export { averageWagePeriodDays, calculateSeverancePay, retirementIncomeTax } from './severance'
export { calculateSocialInsurance } from './social-insurance'
export { splitNonTaxable, statutoryMonthlyLimit } from './non-taxable'
export {
  annualSimpleTaxSteps,
  calculateWageIncomeTax,
  childTaxCredit,
  EXACT_FORMULA,
  generateSimpleTaxTable,
  localIncomeTaxOf,
  lookupSimpleTaxTable,
  MIDPOINT_FORMULA,
  progressiveTax,
} from './wage-income-tax'
export { grossUpFromNet, necessaryExpenseOf, withholdBusinessIncome, withholdDailyWorker, withholdOtherIncome } from './withholding'
export {
  dailyWorkerSocialInsuranceRequired,
  hourlyRateOf,
  isBelowMinimumWage,
  monthlyStandardHours,
  monthlyWageRate,
  MULTIPLIERS_FIVE_OR_MORE,
  MULTIPLIERS_UNDER_FIVE,
  payForHours,
  premiumPay,
  prorate,
  weeklyHolidayAllowance,
  weeklyRestHours,
} from './working-time'
