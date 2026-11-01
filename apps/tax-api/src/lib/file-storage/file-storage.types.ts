/** Metadata about a stored object, used by the orphan sweeper. */
export interface StoredObjectInfo {
  key: string
  createdAt: Date
}

/** Blob storage for uploaded files, kept behind an interface so S3 can replace the local disk. */
export interface FileStorage {
  /** Writes bytes under a key, replacing any existing object. */
  put(key: string, data: Uint8Array): Promise<void>
  /** Reads the bytes stored under a key. */
  get(key: string): Promise<Uint8Array>
  /** Removes an object; missing keys are ignored. */
  delete(key: string): Promise<void>
  /** Lists every stored object. */
  list(): Promise<StoredObjectInfo[]>
}

/** MIME types accepted for uploads. */
export type AllowedMimeType =
  | 'application/pdf'
  | 'image/png'
  | 'image/jpeg'
  | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  | 'text/csv'
