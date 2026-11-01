import type { AccountScope, AccountTitleInfo, AccountTitleNode, AccountTitleRow } from './account-titles.types'

/** Parses the `applies_to` JSON column. */
export function parseAppliesTo(json: string): AccountScope[] {
  const value: unknown = JSON.parse(json)
  return Array.isArray(value) ? value.filter((item): item is AccountScope => typeof item === 'string') : []
}

/** Resolves every account title's report name, group and selectability from the flat row list. */
export function indexAccountTitles(rows: readonly AccountTitleRow[]): Map<string, AccountTitleInfo> {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const parentsWithChildren = new Set(rows.flatMap((row) => (row.parent_id === null ? [] : [row.parent_id])))
  const index = new Map<string, AccountTitleInfo>()
  for (const row of rows) {
    let reportRow = row
    let groupRow = row
    for (let cursor: AccountTitleRow | undefined = row; cursor !== undefined; cursor = cursor.parent_id === null ? undefined : byId.get(cursor.parent_id)) {
      if (cursor.depth === 2) reportRow = cursor
      groupRow = cursor
    }
    index.set(row.id, {
      id: row.id,
      name: row.name,
      depth: row.depth,
      pl_category: row.pl_category,
      cash_category: row.cash_category,
      report_name: reportRow.name,
      group_code: groupRow.code,
      applies_to: parseAppliesTo(row.applies_to),
      is_selectable: row.depth >= 2 && !parentsWithChildren.has(row.id),
    })
  }
  return index
}

/**
 * Builds the three-level tree, optionally keeping only nodes for one scope or matching a search term.
 *
 * A parent is kept when any descendant matches, so the dropdown can still show its group heading.
 */
export function buildAccountTitleTree(rows: readonly AccountTitleRow[], appliesTo?: AccountScope, search?: string): AccountTitleNode[] {
  const index = indexAccountTitles(rows)
  const childrenOf = new Map<string | null, AccountTitleRow[]>()
  for (const row of rows) {
    const siblings = childrenOf.get(row.parent_id) ?? []
    siblings.push(row)
    childrenOf.set(row.parent_id, siblings)
  }
  const term = search?.trim().toLowerCase() ?? ''
  const visit = (row: AccountTitleRow): AccountTitleNode | null => {
    const info = index.get(row.id)
    if (info === undefined) return null
    const children = (childrenOf.get(row.id) ?? []).map(visit).filter((node): node is AccountTitleNode => node !== null)
    const scopeOk = appliesTo === undefined || info.applies_to.includes(appliesTo)
    const searchOk = term === '' || row.name.toLowerCase().includes(term)
    if (children.length === 0 && (!scopeOk || !searchOk || (row.depth === 1 && (appliesTo !== undefined || term !== '')))) return null
    return {
      id: row.id,
      parent_id: row.parent_id,
      depth: row.depth,
      code: row.code,
      name: row.name,
      description: row.description,
      applies_to: info.applies_to,
      pl_category: row.pl_category,
      cash_category: row.cash_category,
      is_system: row.is_system === 1,
      is_auto_etc: row.is_auto_etc === 1,
      is_selectable: info.is_selectable,
      children,
    }
  }
  return (childrenOf.get(null) ?? []).map(visit).filter((node): node is AccountTitleNode => node !== null)
}
