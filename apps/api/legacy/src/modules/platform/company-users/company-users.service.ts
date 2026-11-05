import type { AuthUser, ServiceDeps } from '../../../app.types'
import { transaction } from '../../../db/query'
import { DomainError, invalidField, notFound } from '../../../lib/domain-error'
import { decide } from '../../access/access'
import type { AccessContext, MenuCode } from '../../access/access.types'
import { isMenuCode, MENU_DEFINITIONS } from '../../access/menu-codes'
import { USER_TYPE } from '../../access/user-type'
import { findUserByEmail } from '../accounts/users.repository'
import { isMember } from '../company-profile/company-profile.repository'
import { expireStaleInvitations, findPendingInvitation, listOpenInvitations } from '../invitations/invitations.repository'
import { effectiveStatus, serializeInvitation } from '../invitations/invitations.service'
import { newId, normalizeEmail, parseStringArray } from '../platform.utils'
import {
  countAdmins,
  countRoles,
  deleteFavorite,
  deleteMembership,
  deleteRole,
  findMember,
  findRole,
  insertFavorite,
  insertRole,
  listMemberRoleIds,
  listMembers,
  listMembersOfRole,
  listRoles,
  listRoleTemplates,
  setMemberPermissions,
  updateRole,
} from './company-users.repository'
import type { MemberRow, RoleRow } from './company-users.types'
import { latestMenuLeaves, menuRefs, resolveRoleMenus } from './menu-catalog'

/** Display statuses of the user management tabs. */
export type CompanyUserStatus = 'joined' | 'invited' | 'expired'

/**
 * Lists members and open invitations in one list, as the user management screen shows them.
 *
 * Members come first; invitations follow newest first.
 */
export function listCompanyUsers(deps: ServiceDeps, companyId: string, me: AuthUser, status: CompanyUserStatus | undefined): Record<string, unknown>[] {
  const now = deps.clock.now()
  const roles = roleNameMap(deps, companyId)
  const members = listMembers(deps.db, companyId).map((member) => ({ ...serializeMember(deps, companyId, member, roles), is_me: member.user_id === me.id }))
  const invitations = listOpenInvitations(deps.db, companyId).map((row) => {
    const serialized = serializeInvitation(row, now, roles)
    return {
      ...serialized,
      type: 'invitation',
      user_id: null,
      name: null,
      is_system_admin: false,
      status: effectiveStatus(row, now) === 'pending' ? 'invited' : 'expired',
      is_me: false,
    }
  })
  const rows: Record<string, unknown>[] = [...members, ...invitations]
  return status === undefined ? rows : rows.filter((row) => row.status === status)
}

/**
 * Returns one member with roles and the union of their menus.
 *
 * @throws {DomainError} `NOT_FOUND` when the user is not a member.
 */
export function getCompanyUser(deps: ServiceDeps, companyId: string, userId: string): Record<string, unknown> {
  const member = findMember(deps.db, companyId, userId)
  if (member === undefined) throw notFound('Company user')
  const roleIds = listMemberRoleIds(deps.db, companyId, userId)
  const codes = [...new Set(listRoles(deps.db, companyId).filter((role) => roleIds.includes(role.id)).flatMap((role) => parseStringArray(role.menu_codes)))]
  return { ...serializeMember(deps, companyId, member, roleNameMap(deps, companyId)), menus: menuRefs(deps.db, codes) }
}

/** Reports whether an email can be invited, for the invite modal. */
export function inviteCondition(deps: ServiceDeps, companyId: string, email: string): Record<string, unknown> {
  expireStaleInvitations(deps.db, deps.clock.now())
  const user = findUserByEmail(deps.db, email)
  const member = user !== undefined && isMember(deps.db, companyId, user.id)
  const pending = findPendingInvitation(deps.db, companyId, email) !== undefined
  return {
    email: normalizeEmail(email),
    is_existing_user: user !== undefined,
    is_member: member,
    has_pending_invitation: pending,
    can_invite: !member && !pending && user?.user_type !== USER_TYPE.demoClient,
  }
}

/**
 * Sets a member's admin flag and permission roles.
 *
 * @throws {DomainError} `CONFLICT` when this would leave the company without an
 * admin, `NOT_FOUND`, or `VALIDATION_FAILED` for unknown roles.
 */
export function setPermissions(deps: ServiceDeps, companyId: string, userId: string, isAdmin: boolean, roleIds: readonly string[]): Record<string, unknown> {
  return transaction(deps.db, () => {
    const member = findMember(deps.db, companyId, userId)
    if (member === undefined) throw notFound('Company user')
    const unique = isAdmin ? [] : [...new Set(roleIds)]
    if (countRoles(deps.db, companyId, unique) !== unique.length) throw invalidField('role_ids', 'Unknown permission role.')
    if (member.role === 'admin' && !isAdmin && countAdmins(deps.db, companyId) <= 1) throw new DomainError('CONFLICT', 'A company needs at least one admin.')
    setMemberPermissions(deps.db, companyId, userId, isAdmin, unique)
    return getCompanyUser(deps, companyId, userId)
  })
}

/**
 * Removes a member from the company.
 *
 * @throws {DomainError} `CONFLICT` for the system admin and the last admin.
 */
export function removeCompanyUser(deps: ServiceDeps, companyId: string, userId: string): void {
  transaction(deps.db, () => {
    const member = findMember(deps.db, companyId, userId)
    if (member === undefined) throw notFound('Company user')
    if (member.is_system_admin === 1) throw new DomainError('CONFLICT', 'The system admin cannot be removed.')
    if (member.role === 'admin' && countAdmins(deps.db, companyId) <= 1) throw new DomainError('CONFLICT', 'A company needs at least one admin.')
    deleteMembership(deps.db, companyId, userId)
  })
}

/**
 * Checks a function-level permission: `function` is a menu code and `action` is `read` or `write`.
 *
 * Writes are also denied to demo accounts; writes to `user_management` need the admin role.
 */
export function checkPermission(context: AccessContext, user: AuthUser, fn: string, action: string): Record<string, unknown> {
  let allowed = isMenuCode(fn) && decide(context, fn).ok
  if (action === 'write') {
    allowed = allowed && user.userType !== USER_TYPE.demoClient && (fn !== 'user_management' || context.isAdmin)
  } else if (action !== 'read') {
    allowed = false
  }
  return { function: fn, action, has_permission: allowed }
}

/** Lists the user's accessible menu codes and menu nodes for `GET /user/me/menus/`. */
export function accessibleMenus(deps: ServiceDeps, context: AccessContext): Record<string, unknown> {
  const codes = (Object.keys(MENU_DEFINITIONS) as MenuCode[]).filter((code) => decide(context, code).ok)
  const menus = latestMenuLeaves(deps.db)
    .filter((leaf) => codes.includes(leaf.code))
    .map((leaf) => ({ id: leaf.id, code: leaf.code, name: leaf.name, to: leaf.to }))
  return { accessible_permissions: codes, menus }
}

/** Lists the menus the company's plans and business type allow, regardless of the user's roles. */
export function companyMenus(deps: ServiceDeps, context: AccessContext): Record<string, unknown>[] {
  const companyWide: AccessContext = { ...context, isAdmin: true, isSystemAdmin: true, taxTermsAgreed: true }
  return latestMenuLeaves(deps.db).flatMap((leaf) => {
    const decision = decide(companyWide, leaf.code)
    if (!decision.ok && decision.reason === 'NOT_FOUND') return []
    return [{ id: leaf.id, code: leaf.code, name: leaf.name, to: leaf.to, is_available: decision.ok, promotion_url: decision.ok ? null : decision.promotionUrl }]
  })
}

/**
 * Adds a favorite menu for the signed-in member.
 *
 * @throws {DomainError} `VALIDATION_FAILED` when the menu is unknown or not open to the user.
 */
export function addFavorite(deps: ServiceDeps, context: AccessContext, companyId: string, menuId: number): void {
  const leaf = latestMenuLeaves(deps.db).find((candidate) => candidate.id === menuId)
  if (leaf === undefined || !decide(context, leaf.code).ok) throw invalidField('menu_id', 'This menu cannot be added to favorites.')
  if (context.actor !== 'client') throw new DomainError('PERMISSION_DENIED', 'Only company members have favorites.')
  insertFavorite(deps.db, companyId, context.userId, menuId, deps.clock.now())
}

/** Removes a favorite menu. */
export function removeFavorite(deps: ServiceDeps, companyId: string, userId: string, menuId: number): void {
  if (deleteFavorite(deps.db, companyId, userId, menuId) === 0) throw notFound('Favorite')
}

/** Lists the company's permission roles with their menus and member counts. */
export function listCompanyRoles(deps: ServiceDeps, companyId: string): Record<string, unknown>[] {
  return listRoles(deps.db, companyId).map((role) => serializeRole(deps, role))
}

/** Lists the system default role templates. */
export function listTemplates(deps: ServiceDeps): Record<string, unknown>[] {
  return listRoleTemplates(deps.db).map((row) => {
    const codes = parseStringArray(row.menu_codes)
    return { id: row.id, name: row.name, menu_codes: codes, menus: menuRefs(deps.db, codes) }
  })
}

/**
 * Creates a permission role from menu IDs or codes.
 *
 * @throws {DomainError} `CONFLICT` for duplicate names or `VALIDATION_FAILED` for invalid menus.
 */
export function createRole(deps: ServiceDeps, companyId: string, input: { name: string; menu_ids?: number[] | undefined; menu_codes?: string[] | undefined }): Record<string, unknown> {
  const codes = resolveRoleMenus(deps.db, input.menu_ids, input.menu_codes)
  if (listRoles(deps.db, companyId).some((role) => role.name === input.name)) throw new DomainError('CONFLICT', 'A role with this name already exists.')
  const now = deps.clock.now()
  const row: RoleRow = { id: newId('r'), company_id: companyId, name: input.name, menu_codes: JSON.stringify(codes), created_at: now, updated_at: now }
  insertRole(deps.db, row)
  return serializeRole(deps, row)
}

/** Renames a role or replaces its menus; members see the change on their next request. */
export function patchRole(
  deps: ServiceDeps,
  companyId: string,
  roleId: string,
  input: { name?: string | undefined; menu_ids?: number[] | undefined; menu_codes?: string[] | undefined },
): Record<string, unknown> {
  const role = findRole(deps.db, companyId, roleId)
  if (role === undefined) throw notFound('Role')
  const name = input.name ?? role.name
  if (name !== role.name && listRoles(deps.db, companyId).some((other) => other.name === name)) throw new DomainError('CONFLICT', 'A role with this name already exists.')
  const menus = input.menu_ids === undefined && input.menu_codes === undefined ? role.menu_codes : JSON.stringify(resolveRoleMenus(deps.db, input.menu_ids, input.menu_codes))
  updateRole(deps.db, companyId, roleId, name, menus, deps.clock.now())
  const updated = findRole(deps.db, companyId, roleId)
  if (updated === undefined) throw notFound('Role')
  return serializeRole(deps, updated)
}

/** Deletes a role and removes it from every member. */
export function removeRole(deps: ServiceDeps, companyId: string, roleId: string): void {
  if (findRole(deps.db, companyId, roleId) === undefined) throw notFound('Role')
  deleteRole(deps.db, companyId, roleId)
}

/** Lists the members holding a role, for the delete confirmation. */
export function roleMembers(deps: ServiceDeps, companyId: string, roleId: string): Record<string, unknown>[] {
  if (findRole(deps.db, companyId, roleId) === undefined) throw notFound('Role')
  const roles = roleNameMap(deps, companyId)
  return listMembersOfRole(deps.db, companyId, roleId).map((member) => serializeMember(deps, companyId, member, roles))
}

function serializeRole(deps: ServiceDeps, role: RoleRow): Record<string, unknown> {
  const codes = parseStringArray(role.menu_codes)
  return {
    id: role.id,
    name: role.name,
    menu_codes: codes,
    menus: menuRefs(deps.db, codes),
    user_count: listMembersOfRole(deps.db, role.company_id, role.id).length,
    created_at: role.created_at,
    updated_at: role.updated_at,
  }
}

function serializeMember(deps: ServiceDeps, companyId: string, member: MemberRow, roles: ReadonlyMap<string, string>): Record<string, unknown> {
  return {
    id: member.user_id,
    type: 'user',
    user_id: member.user_id,
    email: member.email,
    name: member.name,
    is_admin: member.role === 'admin',
    is_system_admin: member.is_system_admin === 1,
    roles: listMemberRoleIds(deps.db, companyId, member.user_id).map((id) => ({ id, name: roles.get(id) ?? null })),
    status: 'joined',
    invited_at: null,
    expires_at: null,
    remaining_days: null,
    joined_at: member.joined_at,
  }
}

function roleNameMap(deps: ServiceDeps, companyId: string): Map<string, string> {
  return new Map(listRoles(deps.db, companyId).map((role) => [role.id, role.name]))
}
