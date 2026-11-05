/** A row of `perm_roles`, a company's permission group of menu codes. */
export interface RoleRow {
  id: string
  company_id: string
  name: string
  menu_codes: string
  created_at: string | null
  updated_at: string | null
}

/** A row of `perm_role_templates`, a system default permission group. */
export interface RoleTemplateRow {
  id: string
  name: string
  menu_codes: string
  sort_order: number
}

/** A company member with the user's profile. */
export interface MemberRow {
  user_id: string
  email: string
  name: string | null
  role: 'admin' | 'member'
  is_system_admin: 0 | 1
  joined_at: string | null
}

/** A menu leaf of the catalog, identified by both its numeric node ID and its code. */
export interface MenuRef {
  id: number
  code: string
  name: string
}
