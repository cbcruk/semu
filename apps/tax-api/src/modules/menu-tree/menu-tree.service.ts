import type { DatabaseSync } from 'node:sqlite'
import { queryOne } from '../../db/query'
import { notFound } from '../../lib/domain-error'
import { decide } from '../access/access'
import type { AccessContext, MenuCode } from '../access/access.types'
import type { MenuNode, MenuNodeSource } from './menu-tree.types'

interface ExclusionRule {
  codes: readonly MenuCode[]
  when: (context: AccessContext) => boolean
}

const MENU_EXCLUSION_RULES: readonly ExclusionRule[] = [
  { codes: ['employee_management'], when: (context) => context.hasPayrollPlan },
]

/**
 * Loads a menu tree version, falling back to nothing so the client can retry with `latest`.
 *
 * @throws {DomainError} `NOT_FOUND` when the version does not exist.
 */
export function loadMenuTree(db: DatabaseSync, version: string): MenuNodeSource[] {
  const row =
    version === 'latest'
      ? queryOne<{ tree: string }>(db, 'SELECT tree FROM menu_tree_versions WHERE is_latest = 1')
      : queryOne<{ tree: string }>(db, 'SELECT tree FROM menu_tree_versions WHERE version = ?', [version])
  if (row === undefined) throw notFound('Menu tree version')
  return JSON.parse(row.tree) as MenuNodeSource[]
}

/**
 * Filters a menu tree for one user.
 *
 * Leaves the user may open are kept; leaves blocked only by a missing plan
 * become promotion nodes for free companies; every other blocked leaf is
 * removed, along with sections left empty.
 */
export function buildMenuTree(source: readonly MenuNodeSource[], context: AccessContext, isFreeCompany: boolean): MenuNode[] {
  const excluded = new Set(MENU_EXCLUSION_RULES.filter((rule) => rule.when(context)).flatMap((rule) => rule.codes))
  const visit = (node: MenuNodeSource): MenuNode | null => {
    if (node.code !== null) {
      if (excluded.has(node.code)) return null
      const decision = decide(context, node.code)
      if (decision.ok || decision.reason === 'TAX_TERMS_REQUIRED') return toNode(node, [], null)
      if (decision.reason === 'ENTITLEMENT_REQUIRED' && isFreeCompany) return toNode(node, [], decision.promotionUrl)
      return null
    }
    const children = node.children.map(visit).filter((child): child is MenuNode => child !== null)
    if (node.children.length > 0 && children.length === 0) return null
    return toNode(node, children, null)
  }
  return source.map(visit).filter((node): node is MenuNode => node !== null)
}

function toNode(source: MenuNodeSource, children: MenuNode[], promotionUrl: string | null): MenuNode {
  return {
    id: source.id,
    name: source.name,
    code: source.code,
    category: null,
    accessible_permissions: null,
    is_favoritable: false,
    is_favorite: false,
    favorited_at: null,
    is_promotion: promotionUrl !== null,
    promotion_url: promotionUrl,
    icon: source.icon,
    to: source.to,
    children,
  }
}
