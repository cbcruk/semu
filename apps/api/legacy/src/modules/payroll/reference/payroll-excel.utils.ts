import { isPlainDate } from '../../../lib/plain-date'

/** File name of the upload template, matching the legacy `혜움_급여입력_양식` with a CSV extension. */
export const PAYROLL_TEMPLATE_NAME = '혜움_급여입력_양식.csv'

const COLUMNS = ['소득유형', '성명', '주민등록번호', '내외국인', '거주국가', '지급일', '지급액', '근무일수', '사업소득유형코드', '지급사유코드'] as const

const INCOME_TYPES: Record<string, 'daily' | 'business' | 'other'> = { 일용: 'daily', 사업: 'business', 기타: 'other' }

/** A row parsed from an uploaded payroll sheet. */
export interface ParsedPayrollRow {
  row_number: number
  income_type: 'daily' | 'business' | 'other'
  name: string
  resident_number: string
  is_foreigner: boolean
  residence_country: string
  payment_date: string
  pay_amount: number
  work_days: number | null
  business_income_type_code: string | null
  other_income_type_code: string | null
}

/** Result of {@linkcode parsePayrollSheet}: valid rows and per-row errors. */
export interface ParsedPayrollSheet {
  rows: ParsedPayrollRow[]
  errors: { row_number: number; errors: string[] }[]
}

/** Builds the CSV upload template with a UTF-8 BOM so spreadsheet apps read the Korean header. */
export function payrollTemplateCsv(): string {
  const example = ['일용', '홍길동', '900101-1234567', '내국인', 'KR', '2026-11-10', '1000000', '5', '', '']
  return `﻿${COLUMNS.join(',')}\r\n${example.join(',')}\r\n`
}

/**
 * Parses an uploaded payroll sheet in the template's CSV layout.
 *
 * Rows are validated but not stored; the client fills its grid from the
 * result (spec 7절). Blank lines are skipped.
 */
export function parsePayrollSheet(text: string): ParsedPayrollSheet {
  const lines = parseCsv(text.replace(/^﻿/, ''))
  const result: ParsedPayrollSheet = { rows: [], errors: [] }
  lines.slice(1).forEach((cells, index) => {
    const rowNumber = index + 2
    if (cells.every((cell) => cell.trim() === '')) return
    const value = (column: (typeof COLUMNS)[number]): string => (cells[COLUMNS.indexOf(column)] ?? '').trim()
    const errors: string[] = []
    const incomeType = INCOME_TYPES[value('소득유형')]
    if (incomeType === undefined) errors.push('소득유형 must be 일용, 사업 or 기타.')
    if (value('성명') === '') errors.push('성명 is required.')
    const payAmount = Number(value('지급액').replaceAll(',', ''))
    if (!Number.isSafeInteger(payAmount) || payAmount < 0) errors.push('지급액 must be a non-negative whole number.')
    const paymentDate = value('지급일')
    if (paymentDate !== '' && !isPlainDate(paymentDate)) errors.push('지급일 must be YYYY-MM-DD.')
    const workDaysText = value('근무일수')
    const workDays = workDaysText === '' ? null : Number(workDaysText)
    if (workDays !== null && (!Number.isInteger(workDays) || workDays < 1 || workDays > 31)) errors.push('근무일수 must be between 1 and 31.')
    if (incomeType === 'daily' && workDays === null) errors.push('근무일수 is required for 일용.')
    if (errors.length > 0 || incomeType === undefined) {
      result.errors.push({ row_number: rowNumber, errors })
      return
    }
    result.rows.push({
      row_number: rowNumber,
      income_type: incomeType,
      name: value('성명'),
      resident_number: value('주민등록번호'),
      is_foreigner: value('내외국인') === '외국인',
      residence_country: value('거주국가') || 'KR',
      payment_date: paymentDate,
      pay_amount: payAmount,
      work_days: workDays,
      business_income_type_code: value('사업소득유형코드') || null,
      other_income_type_code: value('지급사유코드') || null,
    })
  })
  return result
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"'
        index += 1
      } else if (char === '"') quoted = false
      else cell += char
    } else if (char === '"') quoted = true
    else if (char === ',') {
      row.push(cell)
      cell = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += char
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}
