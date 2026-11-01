import type { DatabaseSync, SQLInputValue, StatementSync } from 'node:sqlite'

/** A value that can be bound to a SQL parameter. */
export type SqlValue = SQLInputValue

const statementCache = new WeakMap<DatabaseSync, Map<string, StatementSync>>()

function prepare(db: DatabaseSync, sql: string): StatementSync {
  let cache = statementCache.get(db)
  if (cache === undefined) {
    cache = new Map()
    statementCache.set(db, cache)
  }
  let statement = cache.get(sql)
  if (statement === undefined) {
    statement = db.prepare(sql)
    cache.set(sql, statement)
  }
  return statement
}

/** Runs a query and returns the first row, or `undefined` when there is none. */
export function queryOne<T>(db: DatabaseSync, sql: string, params: readonly SqlValue[] = []): T | undefined {
  return prepare(db, sql).get(...params) as unknown as T | undefined
}

/** Runs a query and returns every row. */
export function queryAll<T>(db: DatabaseSync, sql: string, params: readonly SqlValue[] = []): T[] {
  return prepare(db, sql).all(...params) as unknown as T[]
}

/** Runs a statement and returns the number of changed rows. */
export function execute(db: DatabaseSync, sql: string, params: readonly SqlValue[] = []): number {
  return Number(prepare(db, sql).run(...params).changes)
}

/**
 * Runs a synchronous function inside `BEGIN IMMEDIATE … COMMIT`, rolling back when it throws.
 *
 * The callback must not await: SQLite transactions here are synchronous, so
 * any asynchronous I/O belongs before or after the call.
 */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/** Returns `count` comma-separated `?` placeholders. */
export function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ')
}
