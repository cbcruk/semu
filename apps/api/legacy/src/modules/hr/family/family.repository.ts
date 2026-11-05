import type { DatabaseSync } from 'node:sqlite'
import { execute, placeholders, queryAll, queryOne } from '../../../db/query'
import type { PlainDate } from '../../../lib/plain-date.types'
import type { DependantCounts, FamilyAttachmentRow, FamilyMemberRow, FamilyMemberWrite } from './family.types'

const ATTACHMENT_SELECT = `SELECT a.*, f.original_name, f.mime_type, f.size_bytes FROM employee_family_attachments a
  JOIN files f ON f.company_id = a.company_id AND f.id = a.file_id`

/** Lists an employee's family members in registration order. */
export function listFamilyMembers(db: DatabaseSync, companyId: string, employeeId: number): FamilyMemberRow[] {
  return queryAll<FamilyMemberRow>(db, 'SELECT * FROM employee_family_members WHERE company_id = ? AND employee_id = ? ORDER BY id', [
    companyId,
    employeeId,
  ])
}

/** Finds one family member of an employee. */
export function findFamilyMember(db: DatabaseSync, companyId: string, employeeId: number, familyId: number): FamilyMemberRow | undefined {
  return queryOne<FamilyMemberRow>(db, 'SELECT * FROM employee_family_members WHERE company_id = ? AND employee_id = ? AND id = ?', [
    companyId,
    employeeId,
    familyId,
  ])
}

/** Inserts a family member and returns its ID. */
export function insertFamilyMember(db: DatabaseSync, companyId: string, employeeId: number, values: FamilyMemberWrite, now: string): number {
  const entries = Object.entries(values)
  const row = queryOne<{ id: number }>(
    db,
    `INSERT INTO employee_family_members (company_id, employee_id, created_at, updated_at, ${entries.map(([key]) => key).join(', ')})
     VALUES (?, ?, ?, ?, ${placeholders(entries.length)}) RETURNING id`,
    [companyId, employeeId, now, now, ...entries.map(([, value]) => value as string | number | null)],
  )
  if (row === undefined) throw new Error('Family member insert returned no row.')
  return row.id
}

/** Replaces a family member's values. */
export function updateFamilyMember(db: DatabaseSync, companyId: string, familyId: number, values: FamilyMemberWrite, now: string): void {
  const entries = Object.entries(values)
  execute(db, `UPDATE employee_family_members SET ${entries.map(([key]) => `${key} = ?`).join(', ')}, updated_at = ? WHERE company_id = ? AND id = ?`, [
    ...entries.map(([, value]) => value as string | number | null),
    now,
    companyId,
    familyId,
  ])
}

/** Deletes a family member and its attachments. */
export function deleteFamilyMember(db: DatabaseSync, companyId: string, employeeId: number, familyId: number): boolean {
  return execute(db, 'DELETE FROM employee_family_members WHERE company_id = ? AND employee_id = ? AND id = ?', [companyId, employeeId, familyId]) > 0
}

/** Lists the attachments of several family members. */
export function listFamilyAttachments(db: DatabaseSync, companyId: string, familyIds: readonly number[]): FamilyAttachmentRow[] {
  if (familyIds.length === 0) return []
  return queryAll<FamilyAttachmentRow>(
    db,
    `${ATTACHMENT_SELECT} WHERE a.company_id = ? AND a.family_member_id IN (${placeholders(familyIds.length)}) ORDER BY a.id`,
    [companyId, ...familyIds],
  )
}

/** Finds one attachment of a family member. */
export function findFamilyAttachment(db: DatabaseSync, companyId: string, familyId: number, attachmentId: number): FamilyAttachmentRow | undefined {
  return queryOne<FamilyAttachmentRow>(db, `${ATTACHMENT_SELECT} WHERE a.company_id = ? AND a.family_member_id = ? AND a.id = ?`, [
    companyId,
    familyId,
    attachmentId,
  ])
}

/** Inserts an attachment row and returns its ID. */
export function insertFamilyAttachment(db: DatabaseSync, companyId: string, familyId: number, fileId: string, userId: string, now: string): number {
  const row = queryOne<{ id: number }>(
    db,
    `INSERT INTO employee_family_attachments (company_id, family_member_id, file_id, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    [companyId, familyId, fileId, userId, now, now],
  )
  if (row === undefined) throw new Error('Attachment insert returned no row.')
  return row.id
}

/** Points an attachment at a new file. */
export function replaceFamilyAttachmentFile(db: DatabaseSync, companyId: string, attachmentId: number, fileId: string, now: string): void {
  execute(db, 'UPDATE employee_family_attachments SET file_id = ?, updated_at = ? WHERE company_id = ? AND id = ?', [fileId, now, companyId, attachmentId])
}

/** Deletes an attachment row. */
export function deleteFamilyAttachment(db: DatabaseSync, companyId: string, familyId: number, attachmentId: number): boolean {
  return (
    execute(db, 'DELETE FROM employee_family_attachments WHERE company_id = ? AND family_member_id = ? AND id = ?', [companyId, familyId, attachmentId]) > 0
  )
}

/**
 * Counts an employee's deductible dependants on a date (rule R21).
 *
 * Members flagged as year-end deduction targets and born on or before the
 * date count, plus the employee. Children count toward the 8–20 bracket by
 * the year of the date minus the birth year, as the withholding table does.
 */
export function countDependantsAsOf(db: DatabaseSync, companyId: string, employeeId: number, date: PlainDate): DependantCounts {
  const year = Number(date.slice(0, 4))
  const row = queryOne<{ targets: number; children: number }>(
    db,
    `SELECT COUNT(*) AS targets,
       COALESCE(SUM(CASE WHEN relation = '자녀' AND ? - CAST(substr(birth_date, 1, 4) AS INTEGER) BETWEEN 8 AND 20 THEN 1 ELSE 0 END), 0) AS children
     FROM employee_family_members
     WHERE company_id = ? AND employee_id = ? AND is_year_end_target = 1 AND birth_date <= ?`,
    [year, companyId, employeeId, date],
  )
  return { dependents_count: 1 + (row?.targets ?? 0), children_8_to_20_count: row?.children ?? 0 }
}
