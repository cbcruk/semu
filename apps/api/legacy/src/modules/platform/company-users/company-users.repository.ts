import type { DatabaseSync } from 'node:sqlite'
import { execute, placeholders, queryAll, queryOne } from '../../../db/query'
import type { MemberRow, RoleRow, RoleTemplateRow } from './company-users.types'

/** Lists a company's permission roles by name. */
export function listRoles(db: DatabaseSync, companyId: string): RoleRow[] {
  return queryAll<RoleRow>(db, 'SELECT * FROM perm_roles WHERE company_id = ? ORDER BY name, id', [companyId])
}

/** Finds a permission role within a company. */
export function findRole(db: DatabaseSync, companyId: string, roleId: string): RoleRow | undefined {
  return queryOne<RoleRow>(db, 'SELECT * FROM perm_roles WHERE company_id = ? AND id = ?', [companyId, roleId])
}

/** Counts how many of the given role IDs exist in a company. */
export function countRoles(db: DatabaseSync, companyId: string, roleIds: readonly string[]): number {
  if (roleIds.length === 0) return 0
  return (
    queryOne<{ n: number }>(db, `SELECT COUNT(*) AS n FROM perm_roles WHERE company_id = ? AND id IN (${placeholders(roleIds.length)})`, [
      companyId,
      ...roleIds,
    ])?.n ?? 0
  )
}

/** Inserts a permission role. */
export function insertRole(db: DatabaseSync, row: RoleRow): void {
  execute(db, 'INSERT INTO perm_roles (id, company_id, name, menu_codes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [
    row.id,
    row.company_id,
    row.name,
    row.menu_codes,
    row.created_at,
    row.updated_at,
  ])
}

/** Updates a role's name and menus. */
export function updateRole(db: DatabaseSync, companyId: string, roleId: string, name: string, menuCodes: string, now: string): void {
  execute(db, 'UPDATE perm_roles SET name = ?, menu_codes = ?, updated_at = ? WHERE company_id = ? AND id = ?', [name, menuCodes, now, companyId, roleId])
}

/** Deletes a role; memberships lose it through the cascading foreign key. */
export function deleteRole(db: DatabaseSync, companyId: string, roleId: string): void {
  execute(db, 'DELETE FROM perm_roles WHERE company_id = ? AND id = ?', [companyId, roleId])
}

/** Lists the system default role templates. */
export function listRoleTemplates(db: DatabaseSync): RoleTemplateRow[] {
  return queryAll<RoleTemplateRow>(db, 'SELECT * FROM perm_role_templates ORDER BY sort_order, id')
}

/** Lists a company's members with their profiles. */
export function listMembers(db: DatabaseSync, companyId: string): MemberRow[] {
  return queryAll<MemberRow>(
    db,
    `SELECT m.user_id, u.email, u.name, m.role, m.is_system_admin, m.joined_at FROM memberships m
     JOIN users u ON u.id = m.user_id WHERE m.company_id = ? ORDER BY m.role, u.email`,
    [companyId],
  )
}

/** Finds one member of a company. */
export function findMember(db: DatabaseSync, companyId: string, userId: string): MemberRow | undefined {
  return queryOne<MemberRow>(
    db,
    `SELECT m.user_id, u.email, u.name, m.role, m.is_system_admin, m.joined_at FROM memberships m
     JOIN users u ON u.id = m.user_id WHERE m.company_id = ? AND m.user_id = ?`,
    [companyId, userId],
  )
}

/** Lists members holding a role. */
export function listMembersOfRole(db: DatabaseSync, companyId: string, roleId: string): MemberRow[] {
  return queryAll<MemberRow>(
    db,
    `SELECT m.user_id, u.email, u.name, m.role, m.is_system_admin, m.joined_at FROM membership_roles mr
     JOIN memberships m ON m.company_id = mr.company_id AND m.user_id = mr.user_id
     JOIN users u ON u.id = m.user_id WHERE mr.company_id = ? AND mr.role_id = ? ORDER BY u.email`,
    [companyId, roleId],
  )
}

/** Lists the role IDs a member holds. */
export function listMemberRoleIds(db: DatabaseSync, companyId: string, userId: string): string[] {
  return queryAll<{ role_id: string }>(db, 'SELECT role_id FROM membership_roles WHERE company_id = ? AND user_id = ? ORDER BY role_id', [
    companyId,
    userId,
  ]).map((row) => row.role_id)
}

/** Replaces a member's admin flag and roles. */
export function setMemberPermissions(db: DatabaseSync, companyId: string, userId: string, isAdmin: boolean, roleIds: readonly string[]): void {
  execute(db, 'UPDATE memberships SET role = ? WHERE company_id = ? AND user_id = ?', [isAdmin ? 'admin' : 'member', companyId, userId])
  execute(db, 'DELETE FROM membership_roles WHERE company_id = ? AND user_id = ?', [companyId, userId])
  for (const roleId of roleIds) execute(db, 'INSERT INTO membership_roles (company_id, user_id, role_id) VALUES (?, ?, ?)', [companyId, userId, roleId])
}

/** Counts a company's admins. */
export function countAdmins(db: DatabaseSync, companyId: string): number {
  return queryOne<{ n: number }>(db, "SELECT COUNT(*) AS n FROM memberships WHERE company_id = ? AND role = 'admin'", [companyId])?.n ?? 0
}

/** Removes a member; roles and favorites go with the cascading foreign keys. */
export function deleteMembership(db: DatabaseSync, companyId: string, userId: string): void {
  execute(db, 'DELETE FROM memberships WHERE company_id = ? AND user_id = ?', [companyId, userId])
}

/** Lists a member's favorite menu IDs with when they were added. */
export function listFavorites(db: DatabaseSync, companyId: string, userId: string): Map<number, string> {
  return new Map(
    queryAll<{ menu_id: number; created_at: string }>(db, 'SELECT menu_id, created_at FROM menu_favorites WHERE company_id = ? AND user_id = ?', [
      companyId,
      userId,
    ]).map((row) => [row.menu_id, row.created_at]),
  )
}

/** Adds a favorite menu; adding it twice is a no-op. */
export function insertFavorite(db: DatabaseSync, companyId: string, userId: string, menuId: number, now: string): void {
  execute(db, 'INSERT OR IGNORE INTO menu_favorites (company_id, user_id, menu_id, created_at) VALUES (?, ?, ?, ?)', [companyId, userId, menuId, now])
}

/** Removes a favorite menu. */
export function deleteFavorite(db: DatabaseSync, companyId: string, userId: string, menuId: number): number {
  return execute(db, 'DELETE FROM menu_favorites WHERE company_id = ? AND user_id = ? AND menu_id = ?', [companyId, userId, menuId])
}
