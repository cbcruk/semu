import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { dataKeyFingerprint } from './data-key.ts'

/** 키 지문을 두는 표입니다. 저장소 표와 따로 서버 기동 때만 씁니다. */
const META_TABLE = 'semu_meta'
const FINGERPRINT = 'data_key_fingerprint'

/** `filename`의 SQLite 파일에 표가 하나라도 있는지 봅니다. 파일이 없으면 거짓입니다. */
export function databaseHasTables(filename: string): boolean {
  if (!existsSync(filename)) return false
  const db = new DatabaseSync(filename, { readOnly: true })
  try {
    const row = db.prepare(`SELECT count(*) AS count FROM sqlite_master WHERE type = 'table'`).get()
    return Number(row?.['count'] ?? 0) > 0
  } finally {
    db.close()
  }
}

/**
 * 데이터베이스에 남긴 키 지문과 `key`를 비교합니다. 지문이 없으면 지금 키의 지문을 남기고 `RECORDED`입니다.
 *
 * 다르면 예외입니다. 다른 키로 띄우면 저장된 암호문을 하나도 열 수 없으므로 서버를 시작하지 않습니다.
 */
export function verifyDataKeyFingerprint(filename: string, key: Uint8Array): 'RECORDED' | 'MATCHED' {
  const fingerprint = dataKeyFingerprint(key)
  const db = new DatabaseSync(filename)
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS ${META_TABLE} (name TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT`)
    const row = db.prepare(`SELECT value FROM ${META_TABLE} WHERE name = ?`).get(FINGERPRINT)
    if (row === undefined) {
      db.prepare(`INSERT INTO ${META_TABLE} (name, value) VALUES (?, ?)`).run(FINGERPRINT, fingerprint)
      return 'RECORDED'
    }
    if (row['value'] !== fingerprint) {
      throw new Error(
        `the data key does not match the one recorded in ${filename}. ` +
          'Use the original key (SEMU_DATA_KEY or the key file); a different key cannot decrypt the stored data.',
      )
    }
    return 'MATCHED'
  } finally {
    db.close()
  }
}
