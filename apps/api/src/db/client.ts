import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { execute, queryAll, transaction } from './query'

const MIGRATIONS_DIR = new URL('./migrations/', import.meta.url)

/** Opens a SQLite database with WAL, foreign keys and a busy timeout enabled. */
export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
  return db
}

/**
 * Applies pending `migrations/*.sql` files in name order.
 *
 * @returns The names of the migrations that were applied.
 */
export function migrate(db: DatabaseSync): string[] {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL) STRICT')
  const applied = new Set(queryAll<{ name: string }>(db, 'SELECT name FROM schema_migrations').map((row) => row.name))
  const pending = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql') && !applied.has(name))
    .sort()
  for (const name of pending) {
    const sql = readFileSync(new URL(name, MIGRATIONS_DIR), 'utf8')
    transaction(db, () => {
      db.exec(sql)
      execute(db, 'INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)', [name, new Date().toISOString()])
    })
  }
  return pending
}
