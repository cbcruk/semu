/** Which organization lookup a request addresses. */
export type OrganizationTable = 'departments' | 'positions'

/** A row of `departments` or `positions`. */
export interface OrganizationUnitRow {
  id: number
  company_id: string
  name: string
  sort_order: number
  is_used: 0 | 1
  created_at: string
  updated_at: string
}

/** One entry of a bulk save: an existing unit when `id` is set, otherwise a new one. */
export interface OrganizationUnitInput {
  id?: number | undefined
  name: string
}
