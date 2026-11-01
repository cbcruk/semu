import { z } from 'zod'
import { plainDate } from '../shared/hr.schema'

const RELATIONS = [
  '부모',
  '조부모',
  '(시/처)조부모',
  '증조부모',
  '(시/처)증조부모',
  '처부모',
  '시부모',
  '배우자',
  '자녀',
  '사위_자부',
  '손자녀',
  '증손자녀',
  '형제_자매',
  '기타',
  '해당없음',
] as const

const DEPENDANT_TYPES = ['대상자아님', '배우자', '20세_이하', '60세_이상', '장애인', '기초생활대상자', '자녀_장려금_수급자'] as const

/** Body of `POST`/`PUT family-members`. */
export const familyMemberBody = z.object({
  name: z.string().trim().min(1).max(100),
  birth_date: plainDate,
  relation: z.enum(RELATIONS),
  is_local: z.boolean(),
  registration_number: z.string().trim().max(20).nullable().optional(),
  is_tax_free_target: z.boolean().default(false),
  is_year_end_target: z.boolean().default(false),
  year_end_dependant_type: z.enum(DEPENDANT_TYPES).default('대상자아님'),
  is_health_insurance_dependent: z.boolean().default(false),
})
