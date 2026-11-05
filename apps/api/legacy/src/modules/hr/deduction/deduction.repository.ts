import type { DatabaseSync } from 'node:sqlite'
import type { PlainDate } from '../../../lib/plain-date.types'
import { findEffectiveRow, saveEffectiveRow } from '../shared/effective-dated.repository'
import type { DeductionInfoRow, DeductionInfoWrite } from './deduction.types'

/**
 * Finds the income tax and deduction settings in force on a date.
 *
 * @returns The settings, or `undefined` when none were saved on or before the date (the withholding table at 100% then applies).
 */
export function findDeductionInfoAsOf(db: DatabaseSync, companyId: string, employeeId: number, date: PlainDate): DeductionInfoRow | undefined {
  return findEffectiveRow<DeductionInfoRow>(db, 'employee_deduction_infos', companyId, employeeId, date)
}

/** Saves deduction settings effective from a date. */
export function saveDeductionInfo(
  db: DatabaseSync,
  companyId: string,
  employeeId: number,
  effectiveFrom: PlainDate,
  values: DeductionInfoWrite,
  userId: string,
  now: string,
): void {
  saveEffectiveRow(db, 'employee_deduction_infos', companyId, employeeId, effectiveFrom, { ...values }, userId, now)
}
