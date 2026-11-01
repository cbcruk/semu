import type { ServiceDeps } from '../../../app.types'
import { transaction } from '../../../db/query'
import { invalidField, notFound } from '../../../lib/domain-error'
import { ageOn } from '../employees/employees.utils'
import type { EmployeeRow } from '../employees/employees.types'
import { commitHrFile, DOCUMENT_MIME_TYPES, prepareHrFile } from '../shared/hr-files'
import { toFlag } from '../shared/hr.utils'
import { enqueueInsuranceFiling, withdrawInsuranceFilings } from '../shared/insurance-filings.repository'
import { normalizeIdentificationNumber } from '../shared/registration-number'
import {
  deleteFamilyAttachment,
  deleteFamilyMember,
  findFamilyAttachment,
  findFamilyMember,
  insertFamilyAttachment,
  insertFamilyMember,
  replaceFamilyAttachmentFile,
  updateFamilyMember,
} from './family.repository'
import type { FamilyAttachmentRow, FamilyMemberInput as FamilyInput, FamilyMemberRow, FamilyMemberWrite } from './family.types'

/** Oldest age, in full years, at which a child still qualifies for the tax-free childcare allowance. */
export const TAX_FREE_CHILD_MAX_AGE = 6

/** Registers a family member; flagging them as a health insurance dependant queues a 피부양자 report. */
export function createFamilyMember(deps: ServiceDeps, employee: EmployeeRow, input: FamilyInput): FamilyMemberRow {
  const now = deps.clock.now()
  return transaction(deps.db, () => {
    const id = insertFamilyMember(deps.db, employee.company_id, employee.id, toWrite(deps, input, null), now)
    if (input.is_health_insurance_dependent) queueDependentFiling(deps, employee, id, input.name, now)
    return requireFamily(deps, employee, id)
  })
}

/** Replaces a family member's values. */
export function updateFamily(deps: ServiceDeps, employee: EmployeeRow, familyId: number, input: FamilyInput): FamilyMemberRow {
  const now = deps.clock.now()
  return transaction(deps.db, () => {
    const current = requireFamily(deps, employee, familyId)
    updateFamilyMember(deps.db, employee.company_id, familyId, toWrite(deps, input, current), now)
    if (input.is_health_insurance_dependent && current.is_health_insurance_dependent === 0) queueDependentFiling(deps, employee, familyId, input.name, now)
    if (!input.is_health_insurance_dependent && current.is_health_insurance_dependent === 1) {
      withdrawInsuranceFilings(deps.db, employee.company_id, employee.id, 'dependent', 'family_member', familyId, now)
    }
    return requireFamily(deps, employee, familyId)
  })
}

/** Deletes a family member with its attachments. */
export function removeFamilyMember(deps: ServiceDeps, employee: EmployeeRow, familyId: number): void {
  transaction(deps.db, () => {
    requireFamily(deps, employee, familyId)
    withdrawInsuranceFilings(deps.db, employee.company_id, employee.id, 'dependent', 'family_member', familyId, deps.clock.now())
    deleteFamilyMember(deps.db, employee.company_id, employee.id, familyId)
  })
}

/** Uploads a supporting document such as 가족관계증명서 for a family member. */
export async function addFamilyAttachment(
  deps: ServiceDeps,
  employee: EmployeeRow,
  familyId: number,
  upload: { name: string; bytes: Uint8Array },
  userId: string,
): Promise<FamilyAttachmentRow> {
  requireFamily(deps, employee, familyId)
  const prepared = await prepareHrFile(deps, employee.company_id, upload, userId, DOCUMENT_MIME_TYPES)
  return commitHrFile(deps, prepared, (file) => {
    requireFamily(deps, employee, familyId)
    const id = insertFamilyAttachment(deps.db, employee.company_id, familyId, file.id, userId, deps.clock.now())
    return requireAttachment(deps, employee, familyId, id)
  })
}

/** Replaces the file of a family attachment. */
export async function replaceFamilyAttachment(
  deps: ServiceDeps,
  employee: EmployeeRow,
  familyId: number,
  attachmentId: number,
  upload: { name: string; bytes: Uint8Array },
  userId: string,
): Promise<FamilyAttachmentRow> {
  requireAttachment(deps, employee, familyId, attachmentId)
  const prepared = await prepareHrFile(deps, employee.company_id, upload, userId, DOCUMENT_MIME_TYPES)
  return commitHrFile(deps, prepared, (file) => {
    requireAttachment(deps, employee, familyId, attachmentId)
    replaceFamilyAttachmentFile(deps.db, employee.company_id, attachmentId, file.id, deps.clock.now())
    return requireAttachment(deps, employee, familyId, attachmentId)
  })
}

/** Deletes a family attachment. */
export function removeFamilyAttachment(deps: ServiceDeps, employee: EmployeeRow, familyId: number, attachmentId: number): void {
  requireFamily(deps, employee, familyId)
  if (!deleteFamilyAttachment(deps.db, employee.company_id, familyId, attachmentId)) throw notFound('Attachment')
}

/** Loads a family member of the employee or fails with `NOT_FOUND`. */
export function requireFamily(deps: ServiceDeps, employee: EmployeeRow, familyId: number): FamilyMemberRow {
  const family = findFamilyMember(deps.db, employee.company_id, employee.id, familyId)
  if (family === undefined) throw notFound('Family member')
  return family
}

function requireAttachment(deps: ServiceDeps, employee: EmployeeRow, familyId: number, attachmentId: number): FamilyAttachmentRow {
  requireFamily(deps, employee, familyId)
  const attachment = findFamilyAttachment(deps.db, employee.company_id, familyId, attachmentId)
  if (attachment === undefined) throw notFound('Attachment')
  return attachment
}

function toWrite(deps: ServiceDeps, input: FamilyInput, current: FamilyMemberRow | null): FamilyMemberWrite {
  if (input.is_tax_free_target) {
    const isChild = input.relation === '자녀' || input.relation === '손자녀'
    if (!isChild || ageOn(input.birth_date, deps.clock.today()) > TAX_FREE_CHILD_MAX_AGE) {
      throw invalidField('is_tax_free_target', 'Only children aged 6 or under qualify for the tax-free childcare allowance.')
    }
  }
  return {
    name: input.name,
    birth_date: input.birth_date,
    relation: input.relation,
    is_local: toFlag(input.is_local),
    registration_number_enc: encryptNumber(deps, input.registration_number, current),
    is_tax_free_target: toFlag(input.is_tax_free_target),
    is_year_end_target: toFlag(input.is_year_end_target),
    year_end_dependant_type: input.year_end_dependant_type,
    is_health_insurance_dependent: toFlag(input.is_health_insurance_dependent),
  }
}

function encryptNumber(deps: ServiceDeps, raw: string | null | undefined, current: FamilyMemberRow | null): string | null {
  if (raw === undefined || (raw !== null && raw.includes('*'))) return current?.registration_number_enc ?? null
  if (raw === null || raw === '') return null
  const normalized = normalizeIdentificationNumber(raw, 'registration')
  if (normalized === null) throw invalidField('registration_number', 'Enter a valid 13-digit registration number.')
  return deps.cipher.encrypt(normalized)
}

function queueDependentFiling(deps: ServiceDeps, employee: EmployeeRow, familyId: number, name: string, now: string): void {
  enqueueInsuranceFiling(deps.db, {
    companyId: employee.company_id,
    employeeId: employee.id,
    kind: 'dependent',
    sourceType: 'family_member',
    sourceId: familyId,
    payload: { family_member_id: familyId, name },
    now,
  })
}
