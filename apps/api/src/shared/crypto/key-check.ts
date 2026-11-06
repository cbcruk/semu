import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { META_TABLE, ensureMetaTable } from '../persistence/meta.ts'
import { dataKeyFingerprint } from './data-key.ts'

/** 키 지문을 남기는 {@link META_TABLE}의 행 이름입니다. */
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
 * 키 지문 없이 저장소 표가 있는 데이터베이스(데이터 암호화 이전에 만든 것)면 예외입니다. 파일이 없거나 표가 없으면 통과합니다.
 *
 * 어떤 키로 쓴 데이터인지 알 수 없으므로 지금 키를 받아들이지 않습니다. 서버는 키를 고르기 전에 이것부터 봅니다.
 */
export function refuseUnkeyedDatabase(filename: string): void {
  if (!existsSync(filename)) return
  const db = new DatabaseSync(filename, { readOnly: true })
  try {
    refuseUnkeyed(db, filename)
  } finally {
    db.close()
  }
}

function refuseUnkeyed(db: DatabaseSync, filename: string): void {
  const hasMeta =
    db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(META_TABLE) !== undefined
  if (hasMeta && db.prepare(`SELECT 1 FROM ${META_TABLE} WHERE name = ?`).get(FINGERPRINT) !== undefined) return
  const tables = db
    .prepare(`SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT IN (?, 'sqlite_sequence')`)
    .get(META_TABLE)
  if (Number(tables?.['count'] ?? 0) === 0) return
  throw new Error(
    `${filename} has data but no data key fingerprint; it was created before data encryption. ` +
      'Delete the database file and restart to create a new one.',
  )
}

/**
 * 데이터베이스에 남긴 키 지문과 `key`를 비교합니다. 지문이 없는 새 데이터베이스면 지금 키의 지문을 남기고 `RECORDED`입니다.
 *
 * 다르면 예외입니다. 다른 키로 띄우면 저장된 암호문을 하나도 열 수 없으므로 서버를 시작하지 않습니다.
 * 지문 없이 저장소 표가 이미 있으면({@link refuseUnkeyedDatabase}) 지금 키를 남기지 않고 예외입니다.
 */
export function verifyDataKeyFingerprint(filename: string, key: Uint8Array): 'RECORDED' | 'MATCHED' {
  const fingerprint = dataKeyFingerprint(key)
  const db = new DatabaseSync(filename)
  try {
    refuseUnkeyed(db, filename)
    ensureMetaTable(db)
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
