import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { ServiceDeps } from '../../../app.types'
import { transaction } from '../../../db/query'
import { DomainError, invalidField, notFound } from '../../../lib/domain-error'
import {
  countClassifiedInto,
  findAccountTitleRow,
  insertAccountTitleRow,
  listAccountTitleRows,
  moveClassifications,
  nextSortOrder,
  softDeleteAccountTitleRow,
  updateAccountTitleRow,
} from './account-titles.repository'
import type { AccountScope, AccountTitleInfo, AccountTitleNode, AccountTitleRow, CreatedAccountTitle } from './account-titles.types'
import { buildAccountTitleTree, indexAccountTitles } from './account-titles.utils'

/** Returns the account title tree a company sees, optionally narrowed to one scope or a search term. */
export function getAccountTitleTree(db: DatabaseSync, companyId: string, appliesTo?: AccountScope, search?: string): AccountTitleNode[] {
  return buildAccountTitleTree(listAccountTitleRows(db, companyId), appliesTo, search)
}

/** Loads the report metadata of every account title visible to a company, keyed by ID. */
export function loadAccountTitleIndex(db: DatabaseSync, companyId: string): Map<string, AccountTitleInfo> {
  return indexAccountTitles(listAccountTitleRows(db, companyId))
}

/**
 * Checks that transactions of a scope may be classified into an account title.
 *
 * @throws {DomainError} `VALIDATION_FAILED` on `account_title_id` when the title is unknown,
 * belongs to another scope, or has children.
 */
export function assertAssignable(db: DatabaseSync, companyId: string, accountTitleId: string, scope: AccountScope): AccountTitleInfo {
  const info = loadAccountTitleIndex(db, companyId).get(accountTitleId)
  if (info === undefined) throw invalidField('account_title_id', 'Unknown account title.')
  if (!info.applies_to.includes(scope)) throw invalidField('account_title_id', `This account title cannot be used for ${scope}.`)
  if (!info.is_selectable) throw invalidField('account_title_id', 'Choose an account title without sub-accounts.')
  return info
}

/**
 * Adds a company account title under a depth 1 or 2 parent.
 *
 * When the parent had no children and already holds classified transactions,
 * a `기타 {상위명}` child is created first and those transactions move to it,
 * all in one transaction, because the parent stops being selectable.
 */
export function createAccountTitle(
  deps: ServiceDeps,
  companyId: string,
  input: { parent_id: string; name: string; description?: string | null | undefined },
): CreatedAccountTitle {
  const now = deps.clock.now()
  return transaction(deps.db, () => {
    const parent = findAccountTitleRow(deps.db, companyId, input.parent_id)
    if (parent === undefined) throw invalidField('parent_id', 'Unknown parent account title.')
    if (parent.depth === 3) throw invalidField('parent_id', 'Account titles have at most three levels.')
    const hadChildren = listAccountTitleRows(deps.db, companyId).some((row) => row.parent_id === parent.id)
    let autoEtc: AccountTitleRow | null = null
    let moved = 0
    if (!hadChildren && parent.depth === 2 && countClassifiedInto(deps.db, companyId, parent.id) > 0) {
      autoEtc = childOf(parent, companyId, `기타 ${parent.name}`, null, nextSortOrder(deps.db, parent.id), now, true)
      insertAccountTitleRow(deps.db, autoEtc)
      moved = moveClassifications(deps.db, companyId, parent.id, autoEtc.id)
    }
    const created = childOf(parent, companyId, input.name, input.description ?? null, nextSortOrder(deps.db, parent.id), now, false)
    assertUniqueName(deps.db, companyId, parent.id, created.name)
    insertAccountTitleRow(deps.db, created)
    const tree = new Map(flatten(getAccountTitleTree(deps.db, companyId)).map((node) => [node.id, node]))
    const node = tree.get(created.id)
    if (node === undefined) throw notFound('Account title')
    return { account_title: node, auto_created_etc: autoEtc === null ? null : (tree.get(autoEtc.id) ?? null), moved }
  })
}

/**
 * Renames a company account title.
 *
 * @throws {DomainError} `PERMISSION_DENIED` for Alfred default titles.
 */
export function updateAccountTitle(
  deps: ServiceDeps,
  companyId: string,
  id: string,
  input: { name?: string | undefined; description?: string | null | undefined },
): AccountTitleNode {
  return transaction(deps.db, () => {
    const row = requireCompanyTitle(deps.db, companyId, id)
    const name = input.name ?? row.name
    if (name !== row.name && row.parent_id !== null) assertUniqueName(deps.db, companyId, row.parent_id, name)
    updateAccountTitleRow(deps.db, companyId, id, name, input.description === undefined ? row.description : input.description)
    const node = flatten(getAccountTitleTree(deps.db, companyId)).find((candidate) => candidate.id === id)
    if (node === undefined) throw notFound('Account title')
    return node
  })
}

/**
 * Deletes a company account title, moving its classified transactions and rule results to another title.
 *
 * @param moveToId Required when transactions are classified into the title.
 * @returns How many evidence and bank rows moved.
 * @throws {DomainError} `INVALID_TRANSITION` when the title still has sub-accounts.
 */
export function deleteAccountTitle(deps: ServiceDeps, companyId: string, id: string, moveToId: string | undefined): { moved: number } {
  return transaction(deps.db, () => {
    const row = requireCompanyTitle(deps.db, companyId, id)
    if (listAccountTitleRows(deps.db, companyId).some((candidate) => candidate.parent_id === id)) {
      throw new DomainError('INVALID_TRANSITION', 'Delete the sub-accounts first.')
    }
    const used = countClassifiedInto(deps.db, companyId, id)
    let moved = 0
    if (used > 0 || moveToId !== undefined) {
      if (moveToId === undefined) throw invalidField('move_to_id', 'Choose where the classified transactions move.')
      if (moveToId === id) throw invalidField('move_to_id', 'Choose a different account title.')
      const target = loadAccountTitleIndex(deps.db, companyId).get(moveToId)
      if (target === undefined || !target.is_selectable) throw invalidField('move_to_id', 'Choose a selectable account title.')
      moved = moveClassifications(deps.db, companyId, id, moveToId)
    }
    softDeleteAccountTitleRow(deps.db, companyId, row.id, deps.clock.now())
    return { moved }
  })
}

function requireCompanyTitle(db: DatabaseSync, companyId: string, id: string): AccountTitleRow {
  const row = findAccountTitleRow(db, companyId, id)
  if (row === undefined) throw notFound('Account title')
  if (row.company_id === null) throw new DomainError('PERMISSION_DENIED', 'Alfred default account titles cannot be changed.')
  return row
}

function assertUniqueName(db: DatabaseSync, companyId: string, parentId: string, name: string): void {
  if (listAccountTitleRows(db, companyId).some((row) => row.parent_id === parentId && row.name === name)) {
    throw invalidField('name', 'An account title with this name already exists here.')
  }
}

function childOf(
  parent: AccountTitleRow,
  companyId: string,
  name: string,
  description: string | null,
  sortOrder: number,
  now: string,
  isAutoEtc: boolean,
): AccountTitleRow {
  return {
    id: randomUUID(),
    company_id: companyId,
    parent_id: parent.id,
    depth: parent.depth === 1 ? 2 : 3,
    code: null,
    name,
    description,
    applies_to: parent.applies_to,
    pl_category: parent.pl_category,
    cash_category: parent.cash_category,
    is_system: 0,
    is_auto_etc: isAutoEtc ? 1 : 0,
    sort_order: sortOrder,
    deleted_at: null,
    created_at: now,
  }
}

function flatten(nodes: readonly AccountTitleNode[]): AccountTitleNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)])
}
