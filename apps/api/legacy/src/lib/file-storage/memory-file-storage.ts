import type { FileStorage, StoredObjectInfo } from './file-storage.types'

/** Creates an in-memory {@linkcode FileStorage} for tests. */
export function createMemoryFileStorage(): FileStorage & { readonly objects: Map<string, StoredObjectInfo & { data: Uint8Array }> } {
  const objects = new Map<string, StoredObjectInfo & { data: Uint8Array }>()
  return {
    objects,
    async put(key, data): Promise<void> {
      objects.set(key, { key, data: new Uint8Array(data), createdAt: new Date() })
    },
    async get(key): Promise<Uint8Array> {
      const object = objects.get(key)
      if (object === undefined) throw new Error(`Object not found: ${key}`)
      return object.data
    },
    async delete(key): Promise<void> {
      objects.delete(key)
    },
    async list(): Promise<StoredObjectInfo[]> {
      return [...objects.values()].map(({ key, createdAt }) => ({ key, createdAt }))
    },
  }
}
