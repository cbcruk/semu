import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { FileStorage, StoredObjectInfo } from './file-storage.types'

/** Creates a {@linkcode FileStorage} that keeps objects as files under a root directory. */
export function createLocalFileStorage(rootDir: string): FileStorage {
  const root = resolve(rootDir)
  const pathOf = (key: string): string => {
    const path = resolve(root, key)
    if (!path.startsWith(root + sep)) throw new RangeError(`Storage key escapes the root: ${key}`)
    return path
  }
  return {
    async put(key, data): Promise<void> {
      const path = pathOf(key)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, data)
    },
    async get(key): Promise<Uint8Array> {
      return new Uint8Array(await readFile(pathOf(key)))
    },
    async delete(key): Promise<void> {
      await rm(pathOf(key), { force: true })
    },
    async list(): Promise<StoredObjectInfo[]> {
      const entries = await readdir(root, { recursive: true, withFileTypes: true }).catch(() => [])
      const files = entries.filter((entry) => entry.isFile())
      return Promise.all(
        files.map(async (entry) => {
          const path = join(entry.parentPath, entry.name)
          const info = await stat(path)
          return { key: relative(root, path).split(sep).join('/'), createdAt: info.mtime }
        }),
      )
    },
  }
}
