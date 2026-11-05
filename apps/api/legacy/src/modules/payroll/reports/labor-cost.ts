/**
 * Labour cost report (세무 > 인건비 내역, bookkeeping spec 4.8) built from payroll cards.
 *
 * Amounts are pre-tax gross pay by income form and attribution month, plus
 * the employer's social insurance. Only rows of cards that are calculated or
 * later count, so reopening a card for input removes it until it is
 * calculated again; additional cards add to their month.
 *
 * @module
 */
import type { DatabaseSync } from 'node:sqlite'
import type { PlainDate } from '../../../lib/plain-date.types'
import { listEmployees } from '../../hr/employees/employees.repository'
import { CALCULATED_STATUSES } from '../cards/card-status'
import { listCardsOfYear, listRowsOfCards } from '../cards/cards.repository'
import { isWageIncome, monthBounds } from '../cards/cards.utils'

/** Income forms of the report. */
export type LaborCostForm = 'wage' | 'daily' | 'business' | 'other'

/** Amounts of one month or of the year. */
export interface LaborCostAmounts {
  wage: number
  daily: number
  business: number
  other: number
  total: number
  employer_insurance: number
  total_with_employer_insurance: number
  headcount_by_type: Record<LaborCostForm, number>
}

/** Employment trend of one month: employed at month end, joiners and leavers. */
export interface EmploymentTrend {
  month: number
  employed: number
  joined: number
  left: number
}

/** Response of `GET /report/labor-cost/:year`. */
export interface LaborCostReport {
  year: number
  has_data: boolean
  updated: string | null
  monthly: (LaborCostAmounts & { month: number })[]
  cumulative: (Omit<LaborCostAmounts, 'headcount_by_type'> & { month: number })[]
  totals: LaborCostAmounts
  employees: EmploymentTrend[]
  avg_employed: number | null
}

/**
 * Builds the labour cost report of a year.
 *
 * Headcounts count distinct employees (or names for rows without one).
 * The employment trend counts wage employees from HR: leave counts as
 * employed, and a leaver counts as employed in the leaving month only when
 * the leave date is the month's last day. Months after `today` are left out.
 */
export function buildLaborCost(db: DatabaseSync, companyId: string, year: number, today: PlainDate): LaborCostReport {
  const cards = listCardsOfYear(db, companyId, year, CALCULATED_STATUSES)
  const monthOfCard = new Map(cards.map((card) => [card.id, Number(card.attribution_month.slice(5, 7))]))
  const rows = listRowsOfCards(
    db,
    companyId,
    cards.map((card) => card.id),
  ).filter((row) => row.calculated_at !== null)
  const months = Array.from({ length: 12 }, (_, index) => index + 1)
  const people = months.map(() => emptyPeople())
  const yearPeople = emptyPeople()
  const monthly = months.map((month) => ({ month, ...emptyAmounts() }))
  let updated: string | null = null
  for (const row of rows) {
    const index = (monthOfCard.get(row.card_id) ?? 1) - 1
    const entry = monthly[index]
    if (entry === undefined) continue
    const form = formOf(row.income_type)
    entry[form] += row.gross_pay
    entry.employer_insurance += row.employer_insurance_total
    const key = row.employee_id === null ? `name:${row.name}` : `id:${row.employee_id}`
    people[index]?.[form].add(key)
    yearPeople[form].add(key)
    if (row.calculated_at !== null && (updated === null || row.calculated_at > updated)) updated = row.calculated_at
  }
  for (const [index, entry] of monthly.entries()) {
    entry.total = entry.wage + entry.daily + entry.business + entry.other
    entry.total_with_employer_insurance = entry.total + entry.employer_insurance
    entry.headcount_by_type = countsOf(people[index] ?? emptyPeople())
  }
  const running = { wage: 0, daily: 0, business: 0, other: 0, total: 0, employer_insurance: 0, total_with_employer_insurance: 0 }
  const cumulative = monthly.map((entry) => {
    for (const key of Object.keys(running) as (keyof typeof running)[]) running[key] += entry[key]
    return { month: entry.month, ...running }
  })
  const totals: LaborCostAmounts = { ...running, headcount_by_type: countsOf(yearPeople) }
  const employees = employmentTrend(db, companyId, year, today)
  return {
    year,
    has_data: rows.length > 0,
    updated,
    monthly,
    cumulative,
    totals,
    employees,
    avg_employed: employees.length === 0 ? null : Math.round((employees.reduce((total, entry) => total + entry.employed, 0) / employees.length) * 10) / 10,
  }
}

/** Renders the labour cost report as CSV with a UTF-8 BOM. */
export function laborCostCsv(report: LaborCostReport): string {
  const header = ['월', '근로소득', '일용근로소득', '사업소득', '기타소득', '총 인건비', '사업주 부담 4대보험', '총 인건비(사업주 부담 포함)', '재직자', '입사자', '퇴사자']
  const trend = new Map(report.employees.map((entry) => [entry.month, entry]))
  const lines = report.monthly.map((entry) => {
    const people = trend.get(entry.month)
    return [
      `${report.year}-${String(entry.month).padStart(2, '0')}`,
      entry.wage,
      entry.daily,
      entry.business,
      entry.other,
      entry.total,
      entry.employer_insurance,
      entry.total_with_employer_insurance,
      people?.employed ?? '',
      people?.joined ?? '',
      people?.left ?? '',
    ].join(',')
  })
  const totals = report.totals
  lines.push(['합계', totals.wage, totals.daily, totals.business, totals.other, totals.total, totals.employer_insurance, totals.total_with_employer_insurance, '', '', ''].join(','))
  return `﻿${[header.join(','), ...lines].join('\r\n')}\r\n`
}

function employmentTrend(db: DatabaseSync, companyId: string, year: number, today: PlainDate): EmploymentTrend[] {
  const currentYear = Number(today.slice(0, 4))
  if (year > currentYear) return []
  const lastMonth = year === currentYear ? Number(today.slice(5, 7)) : 12
  const employees = listEmployees(db, companyId, today, ['wage-salary'])
  return Array.from({ length: lastMonth }, (_, index) => {
    const month = index + 1
    const { start, end } = monthBounds(`${year}-${String(month).padStart(2, '0')}`)
    let employed = 0
    let joined = 0
    let left = 0
    for (const employee of employees) {
      if (employee.joinDate !== null && employee.joinDate >= start && employee.joinDate <= end) joined++
      if (employee.leaveDate !== null && employee.leaveDate >= start && employee.leaveDate <= end) left++
      const hasJoined = employee.joinDate === null || employee.joinDate <= end
      const stillEmployed = employee.leaveDate === null || employee.leaveDate >= end
      if (hasJoined && stillEmployed) employed++
    }
    return { month, employed, joined, left }
  })
}

function formOf(incomeType: Parameters<typeof isWageIncome>[0]): LaborCostForm {
  if (isWageIncome(incomeType)) return 'wage'
  return incomeType as LaborCostForm
}

function emptyAmounts(): LaborCostAmounts {
  return {
    wage: 0,
    daily: 0,
    business: 0,
    other: 0,
    total: 0,
    employer_insurance: 0,
    total_with_employer_insurance: 0,
    headcount_by_type: { wage: 0, daily: 0, business: 0, other: 0 },
  }
}

function emptyPeople(): Record<LaborCostForm, Set<string>> {
  return { wage: new Set(), daily: new Set(), business: new Set(), other: new Set() }
}

function countsOf(people: Record<LaborCostForm, Set<string>>): Record<LaborCostForm, number> {
  return { wage: people.wage.size, daily: people.daily.size, business: people.business.size, other: people.other.size }
}
