import type { DatabaseSync } from 'node:sqlite'
import { invalidField } from '../../../lib/domain-error'
import { decide } from '../../access/access'
import type { AccessContext, MenuCode } from '../../access/access.types'
import { isMenuCode, MENU_DEFINITIONS } from '../../access/menu-codes'
import { loadMenuTree } from '../../menu-tree/menu-tree.service'
import type { MenuNode, MenuNodeSource } from '../../menu-tree/menu-tree.types'
import type { MenuRef } from './company-users.types'

/** A leaf of the latest menu tree with the labels of its ancestors. */
export interface MenuLeaf extends MenuRef {
  code: MenuCode
  to: string | null
  group: string
}

/** Lists the coded leaves of the latest menu tree, so numeric menu IDs and codes can be translated. */
export function latestMenuLeaves(db: DatabaseSync): MenuLeaf[] {
  const leaves: MenuLeaf[] = []
  const visit = (node: MenuNodeSource, group: string): void => {
    if (node.code !== null && node.children.length === 0) leaves.push({ id: node.id, code: node.code, name: node.name, to: node.to, group })
    for (const child of node.children) visit(child, node.code === null ? node.name : group)
  }
  for (const node of loadMenuTree(db, 'latest')) visit(node, node.name)
  return leaves
}

/** Checks whether a menu is granted through permission roles rather than to everyone. */
export function isPermissionMenu(code: MenuCode): boolean {
  return MENU_DEFINITIONS[code].requiresPermission
}

/**
 * Builds the permission catalog of `GET /api/perm/menus`: 2-depth groups with their 3-depth leaves.
 *
 * Only menus granted through roles appear. When an access context is given,
 * each leaf also reports whether that user may open it, using the same
 * {@linkcode decide} call as the menu tree and the API guards.
 */
export function permissionCatalog(db: DatabaseSync, context: AccessContext | null): Record<string, unknown>[] {
  const groups = (nodes: readonly MenuNodeSource[]): Record<string, unknown>[] =>
    nodes.flatMap((node) => {
      if (node.code !== null) return []
      const leaves = node.children.filter((child) => child.code !== null && child.children.length === 0 && isPermissionMenu(child.code))
      const nested = groups(node.children)
      if (leaves.length === 0) return nested
      return [
        {
          id: node.id,
          name: node.name,
          children: leaves.map((leaf) => ({
            id: leaf.id,
            name: leaf.name,
            code: leaf.code,
            to: leaf.to,
            ...(context === null || leaf.code === null ? {} : { is_accessible: decide(context, leaf.code).ok }),
          })),
        },
        ...nested,
      ]
    })
  return groups(loadMenuTree(db, 'latest'))
}

/**
 * Resolves role menus sent as numeric `menu_ids` or as `menu_codes` to codes.
 *
 * @throws {DomainError} `VALIDATION_FAILED` for unknown menus or menus not granted through roles.
 */
export function resolveRoleMenus(db: DatabaseSync, menuIds: readonly number[] | undefined, menuCodes: readonly string[] | undefined): MenuCode[] {
  const leaves = latestMenuLeaves(db)
  const codes: MenuCode[] = []
  for (const id of menuIds ?? []) {
    const leaf = leaves.find((candidate) => candidate.id === id)
    if (leaf === undefined) throw invalidField('menu_ids', `Unknown menu ${id}.`)
    codes.push(leaf.code)
  }
  for (const code of menuCodes ?? []) {
    if (!isMenuCode(code)) throw invalidField('menu_codes', `Unknown menu ${code}.`)
    codes.push(code)
  }
  const unique = [...new Set(codes)]
  const invalid = unique.find((code) => !isPermissionMenu(code))
  if (invalid !== undefined) throw invalidField('menu_ids', `${invalid} is open to every user and cannot be granted.`)
  return unique
}

/** Maps role menu codes to catalog references, keeping codes that have no node in the latest tree. */
export function menuRefs(db: DatabaseSync, codes: readonly string[]): (MenuRef | { id: null; code: string; name: null })[] {
  const leaves = latestMenuLeaves(db)
  return codes.map((code) => {
    const leaf = leaves.find((candidate) => candidate.code === code)
    return leaf === undefined ? { id: null, code, name: null } : { id: leaf.id, code: leaf.code, name: leaf.name }
  })
}

/** Marks favoritable leaves and the user's favorites on a filtered menu tree. */
export function annotateFavorites(nodes: readonly MenuNode[], context: AccessContext, favorites: ReadonlyMap<number, string>): MenuNode[] {
  return nodes.map((node) => {
    if (node.children.length > 0) return { ...node, children: annotateFavorites(node.children, context, favorites) }
    const favoritable = node.code !== null && !node.is_promotion && decide(context, node.code).ok
    const favoritedAt = favorites.get(node.id) ?? null
    return { ...node, is_favoritable: favoritable, is_favorite: favoritable && favoritedAt !== null, favorited_at: favoritable ? favoritedAt : null }
  })
}
