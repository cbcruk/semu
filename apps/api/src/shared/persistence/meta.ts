import type { DatabaseSync } from 'node:sqlite'

/**
 * 저장소 자체에 대한 기록을 두는 표입니다. `(name, value)` 두 열입니다.
 *
 * - `data_key_fingerprint`: 데이터 키 지문(`src/shared/crypto/key-check.ts`)
 * - `seeded:<table>`: 그 표에 시드를 넣었다는 표시와 넣은 시각({@link seededMarker})
 */
export const META_TABLE = 'semu_meta'

/** {@link META_TABLE}이 없으면 만듭니다. */
export function ensureMetaTable(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS ${META_TABLE} (name TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT`)
}

/** 표 `table`에 시드를 넣었다는 표시의 이름입니다. */
export function seededMarker(table: string): string {
  return `seeded:${table}`
}
