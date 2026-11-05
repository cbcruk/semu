import type { z } from 'zod'
import type { familyMemberBody } from './family.schema'

/** Parsed body of `POST`/`PUT family-members`. */
export type FamilyMemberInput = z.infer<typeof familyMemberBody>

/** Relation of a family member to the employee, in the client's Korean enum values. */
export type FamilyRelation =
  | '부모'
  | '조부모'
  | '(시/처)조부모'
  | '증조부모'
  | '(시/처)증조부모'
  | '처부모'
  | '시부모'
  | '배우자'
  | '자녀'
  | '사위_자부'
  | '손자녀'
  | '증손자녀'
  | '형제_자매'
  | '기타'
  | '해당없음'

/** Year-end settlement dependant category. */
export type YearEndDependantType = '대상자아님' | '배우자' | '20세_이하' | '60세_이상' | '장애인' | '기초생활대상자' | '자녀_장려금_수급자'

/** A row of `employee_family_members`. */
export interface FamilyMemberRow {
  id: number
  company_id: string
  employee_id: number
  name: string
  birth_date: string
  relation: FamilyRelation
  is_local: 0 | 1
  registration_number_enc: string | null
  is_tax_free_target: 0 | 1
  is_year_end_target: 0 | 1
  year_end_dependant_type: YearEndDependantType
  is_health_insurance_dependent: 0 | 1
  created_at: string
  updated_at: string
}

/** Values written to a family member. */
export type FamilyMemberWrite = Omit<FamilyMemberRow, 'id' | 'company_id' | 'employee_id' | 'created_at' | 'updated_at'>

/** A family attachment joined with its file metadata. */
export interface FamilyAttachmentRow {
  id: number
  company_id: string
  family_member_id: number
  file_id: string
  created_by: string | null
  created_at: string
  updated_at: string
  original_name: string
  mime_type: string
  size_bytes: number
}

/** Dependant counts used by the simplified withholding table (간이세액표). */
export interface DependantCounts {
  /** Deductible family members including the employee. */
  dependents_count: number
  /** Deductible children aged 8 to 20 in the year of the date. */
  children_8_to_20_count: number
}
