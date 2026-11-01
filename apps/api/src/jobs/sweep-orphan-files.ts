import type { DatabaseSync } from 'node:sqlite'
import { queryAll } from '../db/query'
import type { FileStorage } from '../lib/file-storage/file-storage.types'

/**
 * Deletes stored blobs that no `files` row references.
 *
 * Blobs are written before the metadata transaction, so a crash in between
 * leaves an orphan. Only objects older than the grace period are removed, to
 * avoid racing uploads that are still committing.
 *
 * @returns The keys that were deleted.
 */
export async function sweepOrphanFiles(db: DatabaseSync, storage: FileStorage, now: Date, graceHours = 24): Promise<string[]> {
  const referenced = new Set(queryAll<{ storage_key: string }>(db, 'SELECT storage_key FROM files').map((row) => row.storage_key))
  const cutoff = now.getTime() - graceHours * 60 * 60 * 1000
  const orphans = (await storage.list()).filter((object) => !referenced.has(object.key) && object.createdAt.getTime() < cutoff)
  for (const orphan of orphans) await storage.delete(orphan.key)
  return orphans.map((orphan) => orphan.key)
}
