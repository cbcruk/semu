import { addDays, addMonths, daysBetween } from '../../../lib/plain-date'
import type { PlainDate } from '../../../lib/plain-date.types'
import { ageOn } from '../employees/employees.utils'
import type { FixedAllowanceKind, IndefiniteConversionAlert, WageInput, WageResult, WorkContractRow, WorkContractStatus } from './contracts.types'

/** Statutory minimum hourly wage for 2026 in won (최저임금위원회 고시). */
export const MINIMUM_HOURLY_WAGE_2026 = 10_320

/** Days before the two-year mark at which the conversion alert starts. */
export const INDEFINITE_CONVERSION_NOTICE_DAYS = 90

const FIXED_KINDS: readonly FixedAllowanceKind[] = ['overtime', 'night', 'holiday', 'holiday_overtime']

/**
 * Multiplier applied to the ordinary hourly wage for each fixed allowance hour.
 *
 * Screens show `ordinary hourly × hours` with no premium (see the R10 note in
 * the spec), so every multiplier is 1.0 until payroll confirms the formula.
 */
export const FIXED_ALLOWANCE_MULTIPLIER: Record<FixedAllowanceKind, number> = {
  overtime: 1,
  night: 1,
  holiday: 1,
  holiday_overtime: 1,
}

/** Computes a work contract's state on a date from its start and end dates. */
export function workContractStatus(contract: Pick<WorkContractRow, 'start_date' | 'end_date'>, today: PlainDate): WorkContractStatus {
  if (contract.start_date > today) return 'scheduled'
  if (contract.end_date !== null && contract.end_date < today) return 'expired'
  return 'active'
}

/**
 * Derives base salary and hourly wages from a payroll contract's inputs (rules R8–R10).
 *
 * For a monthly wage with automatic fixed allowances the ordinary hourly wage
 * `o` and the allowances depend on each other. With `A` the monthly amount,
 * `P` all enabled pay items, `Pₒ` those in 통상임금, `B` the yearly bonus
 * when it counts as ordinary wage, `M` the monthly hours and `H` the
 * multiplier-weighted fixed hours, solving `base = A − P − H·o` and
 * `o = (base + Pₒ + B/12) / M` gives `o = (A − P + Pₒ + B/12) / (M + H)`.
 *
 * @example A 3,000,000 won monthly wage with 10 fixed overtime hours
 * ```ts
 * import { calculateWage } from './contracts.utils'
 *
 * const result = calculateWage({
 *   wageType: 'monthly', amount: 3_000_000, monthlyWorkHours: 209, dailyWorkHours: null,
 *   paymentItems: [], autoCalc: true, hasBonus: false, bonusAmount: null, bonusInOrdinaryWage: false,
 *   probationPayRate: null,
 *   fixed: {
 *     overtime: { enabled: true, hours: 10, amount: 0 }, night: { enabled: false, hours: 0, amount: 0 },
 *     holiday: { enabled: false, hours: 0, amount: 0 }, holiday_overtime: { enabled: false, hours: 0, amount: 0 },
 *   },
 * })
 * result.fixedAmounts.overtime + result.baseSalary // 3_000_000
 * ```
 */
export function calculateWage(input: WageInput): WageResult {
  const enabledItems = input.paymentItems.filter((item) => item.is_enabled)
  const itemsTotal = sum(enabledItems.map((item) => item.amount))
  const ordinaryItems = sum(enabledItems.filter((item) => item.is_ordinary_wage !== false).map((item) => item.amount))
  const minimumWageItems = sum(enabledItems.filter((item) => item.counts_toward_minimum_wage !== false).map((item) => item.amount))
  const bonusMonthly = input.hasBonus && input.bonusInOrdinaryWage ? (input.bonusAmount ?? 0) / 12 : 0
  const hours = input.monthlyWorkHours
  const fixedAmounts = { overtime: 0, night: 0, holiday: 0, holiday_overtime: 0 }
  let baseSalary: number
  let ordinaryHourly: number
  if (input.wageType === 'monthly') {
    if (input.autoCalc) {
      const weightedHours = sum(FIXED_KINDS.map((kind) => (input.fixed[kind].enabled ? input.fixed[kind].hours * FIXED_ALLOWANCE_MULTIPLIER[kind] : 0)))
      ordinaryHourly = (input.amount - itemsTotal + ordinaryItems + bonusMonthly) / (hours + weightedHours)
      for (const kind of FIXED_KINDS) {
        if (input.fixed[kind].enabled) fixedAmounts[kind] = Math.round(ordinaryHourly * input.fixed[kind].hours * FIXED_ALLOWANCE_MULTIPLIER[kind])
      }
      baseSalary = input.amount - itemsTotal - sum(Object.values(fixedAmounts))
    } else {
      for (const kind of FIXED_KINDS) if (input.fixed[kind].enabled) fixedAmounts[kind] = input.fixed[kind].amount
      baseSalary = input.amount - itemsTotal - sum(Object.values(fixedAmounts))
      ordinaryHourly = (baseSalary + ordinaryItems + bonusMonthly) / hours
    }
  } else {
    const hourly = input.wageType === 'hourly' ? input.amount : input.amount / (input.dailyWorkHours ?? 8)
    baseSalary = Math.round(hourly * hours)
    ordinaryHourly = hourly + (ordinaryItems + bonusMonthly) / hours
  }
  const baseHourly = baseSalary / hours
  const minimumWageHourly = (baseSalary + minimumWageItems) / hours
  return {
    baseSalary,
    baseHourlyWage: round2(baseHourly),
    ordinaryHourlyWage: round2(ordinaryHourly),
    probationHourlyWage: input.probationPayRate === null ? null : round2((baseHourly * input.probationPayRate) / 100),
    fixedAmounts,
    minimumWageHourly: round2(minimumWageHourly),
    isBelowMinimumWage: minimumWageHourly < MINIMUM_HOURLY_WAGE_2026,
  }
}

/**
 * Checks whether consecutive fixed-term contracts reach two years (기간제법 제4조).
 *
 * Contracts chain when the next starts no later than the day after the
 * previous one ends. The chain checked is the one containing the latest
 * fixed-term contract. Employees aged 55 or over at the chain start are exempt.
 *
 * @param birthDate The employee's birth date, or `null` when unknown.
 */
export function indefiniteConversionAlert(
  contracts: readonly Pick<WorkContractRow, 'contract_type' | 'start_date' | 'end_date'>[],
  birthDate: string | null,
  today: PlainDate,
): IndefiniteConversionAlert {
  const fixedTerm = contracts
    .filter((contract) => contract.contract_type === 'contract' && contract.end_date !== null)
    .map((contract) => ({ start: contract.start_date as PlainDate, end: contract.end_date as PlainDate }))
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
  const empty: IndefiniteConversionAlert = {
    is_target: false,
    status: 'none',
    is_exempt: false,
    exempt_reason: null,
    chain_start_date: null,
    chain_end_date: null,
    total_contract_days: 0,
    conversion_date: null,
    days_until_conversion: null,
  }
  const last = fixedTerm.at(-1)
  if (last === undefined) return empty
  let chainStart = last.start
  let chainEnd = last.end
  for (let index = fixedTerm.length - 2; index >= 0; index -= 1) {
    const previous = fixedTerm[index]
    if (previous === undefined || addDays(previous.end, 1) < chainStart) break
    chainStart = previous.start < chainStart ? previous.start : chainStart
    chainEnd = previous.end > chainEnd ? previous.end : chainEnd
  }
  const conversionDate = addMonths(chainStart, 24)
  const exempt = birthDate !== null && ageOn(birthDate, chainStart) >= 55
  const daysUntil = daysBetween(today, conversionDate)
  const status = chainEnd >= conversionDate ? 'exceeded' : chainEnd >= today && daysUntil <= INDEFINITE_CONVERSION_NOTICE_DAYS ? 'approaching' : 'none'
  return {
    is_target: !exempt && status !== 'none',
    status,
    is_exempt: exempt,
    exempt_reason: exempt ? 'aged_55_or_over' : null,
    chain_start_date: chainStart,
    chain_end_date: chainEnd,
    total_contract_days: daysBetween(chainStart, chainEnd) + 1,
    conversion_date: conversionDate,
    days_until_conversion: daysUntil,
  }
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
