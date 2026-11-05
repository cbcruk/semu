import { Context, Effect, Layer, Option, Ref } from 'effect'
import type { Id } from '../ids/ids.types.ts'
import { decodeRecord, encodeRecord } from './json-codec.ts'
import { META_TABLE, ensureMetaTable, seededMarker } from './meta.ts'
import { SqliteDatabase } from './unit-of-work.ts'

/** 저장 레코드입니다. ID는 테이블 안에서 유일합니다. */
export interface StoredRecord {
  readonly id: string
}

/** 회사(테넌트)에 속한 저장 레코드입니다. */
export interface TenantRecord extends StoredRecord {
  readonly companyId: Id<'company'>
}

/**
 * ID로 찾고 바꾸는 레코드 표입니다. 목록은 ID(ULID) 순, 곧 만든 순입니다.
 *
 * 저장소는 이 표 위에 조건 검색을 얹습니다. 조건은 지금 메모리에서 거릅니다. 느려지면 그 저장소만 SQL 조회로 바꿉니다.
 */
export interface RecordTable<T extends StoredRecord> {
  get(id: string): Effect.Effect<Option.Option<T>>
  /** 전체 레코드입니다. */
  all(): Effect.Effect<ReadonlyArray<T>>
  /** 회사 키가 있는 표에서 그 회사의 레코드입니다. 회사 키가 없는 표는 빈 배열입니다. */
  byCompany(companyId: Id<'company'>): Effect.Effect<ReadonlyArray<T>>
  /** 레코드를 저장합니다. 같은 ID가 있으면 바꿉니다. */
  put(record: T): Effect.Effect<void>
  remove(id: string): Effect.Effect<void>
}

/** 표를 만들 때의 설정입니다. */
export interface TableOptions<T extends StoredRecord> {
  /**
   * 표를 처음 만들 때 넣을 레코드입니다. SQLite는 표마다 한 번만 넣고 `semu_meta`에 표시를 남깁니다.
   * 시드 행을 모두 지워도 재시작 때 되살아나지 않습니다.
   */
  readonly seed?: ReadonlyArray<T>
  /** 레코드의 회사입니다. 주면 `byCompany`가 색인으로 찾습니다. */
  readonly companyOf?: (record: T) => string | null
}

/**
 * 저장소가 쓰는 표를 만듭니다. 메모리와 SQLite 구현이 같은 표 이름·시드로 같은 동작을 합니다.
 *
 * 표 이름은 `<context>_<collection>`(snake_case)입니다. 예: `tax_filings`.
 */
export class TableFactory extends Context.Service<
  TableFactory,
  {
    make<T extends StoredRecord>(name: string, options?: TableOptions<T>): Effect.Effect<RecordTable<T>>
  }
>()('semu/persistence/TableFactory') {
  /** 프로세스 메모리에 둡니다. 표마다 따로 만들어지고 프로세스가 끝나면 사라집니다. */
  static readonly layerMemory = Layer.succeed(
    TableFactory,
    TableFactory.of({ make: (_name, options = {}) => makeMemoryRecordTable(options) }),
  )

  /** SQLite에 둡니다. 표는 `(id, company_id, data)` 세 열이고, `data`는 {@link encodeRecord}의 JSON입니다. */
  static readonly layerSqlite: Layer.Layer<TableFactory, never, SqliteDatabase> = Layer.effect(
    TableFactory,
    Effect.gen(function* () {
      const { db } = yield* SqliteDatabase
      return TableFactory.of({
        make: (name, options = {}) => Effect.sync(() => makeSqliteRecordTable(db, name, options)),
      })
    }),
  )
}

function byId(a: StoredRecord, b: StoredRecord): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** 메모리 표입니다. 시드 레코드를 그대로 담습니다. */
export function makeMemoryRecordTable<T extends StoredRecord>(
  options: TableOptions<T> = {},
): Effect.Effect<RecordTable<T>> {
  const companyOf = options.companyOf ?? (() => null)
  return Effect.map(Ref.make(new Map((options.seed ?? []).map((record) => [record.id, record]))), (store) => ({
    get: (id) => Effect.map(Ref.get(store), (records) => Option.fromNullishOr(records.get(id))),
    all: () => Effect.map(Ref.get(store), (records) => [...records.values()].sort(byId)),
    byCompany: (companyId) =>
      Effect.map(Ref.get(store), (records) =>
        [...records.values()].filter((record) => companyOf(record) === companyId).sort(byId),
      ),
    put: (record) => Ref.update(store, (records) => new Map(records).set(record.id, record)),
    remove: (id) =>
      Ref.update(store, (records) => {
        if (!records.has(id)) return records
        const next = new Map(records)
        next.delete(id)
        return next
      }),
  }))
}

const TABLE_NAME = /^[a-z][a-z0-9_]*$/

/** SQLite 표입니다. 없으면 만들고 시드를 한 번만 넣습니다. 읽을 때마다 JSON을 풀어 새 객체를 돌려줍니다. */
export function makeSqliteRecordTable<T extends StoredRecord>(
  db: import('node:sqlite').DatabaseSync,
  name: string,
  options: TableOptions<T> = {},
): RecordTable<T> {
  if (!TABLE_NAME.test(name)) throw new Error(`Invalid table name: ${name}`)
  const companyOf = options.companyOf ?? (() => null)
  db.exec(
    `CREATE TABLE IF NOT EXISTS ${name} (id TEXT PRIMARY KEY, company_id TEXT, data TEXT NOT NULL) STRICT;` +
      `CREATE INDEX IF NOT EXISTS ${name}_company ON ${name} (company_id, id);`,
  )
  const seed = options.seed ?? []
  if (seed.length > 0) {
    seedOnce(db, name, () => {
      // 같은 파일을 연 다른 프로세스가 먼저 넣었어도 기본 키 충돌로 실패하지 않게 합니다.
      const insertSeed = db.prepare(`INSERT OR IGNORE INTO ${name} (id, company_id, data) VALUES (?, ?, ?)`)
      for (const record of seed) insertSeed.run(record.id, companyOf(record), encodeRecord(record))
    })
  }

  const selectOne = db.prepare(`SELECT data FROM ${name} WHERE id = ?`)
  const selectAll = db.prepare(`SELECT data FROM ${name} ORDER BY id`)
  const selectCompany = db.prepare(`SELECT data FROM ${name} WHERE company_id = ? ORDER BY id`)
  const upsert = db.prepare(
    `INSERT INTO ${name} (id, company_id, data) VALUES (?, ?, ?) ` +
      `ON CONFLICT (id) DO UPDATE SET company_id = excluded.company_id, data = excluded.data`,
  )
  const deleteOne = db.prepare(`DELETE FROM ${name} WHERE id = ?`)
  const decodeRows = (rows: ReadonlyArray<Record<string, unknown>>) =>
    rows.map((row) => decodeRecord<T>(row['data'] as string))

  return {
    get: (id) =>
      Effect.sync(() => {
        const row = selectOne.get(id)
        return row === undefined ? Option.none() : Option.some(decodeRecord<T>(row['data'] as string))
      }),
    all: () => Effect.sync(() => decodeRows(selectAll.all())),
    byCompany: (companyId) => Effect.sync(() => decodeRows(selectCompany.all(companyId))),
    put: (record) =>
      Effect.sync(() => {
        upsert.run(record.id, companyOf(record), encodeRecord(record))
      }),
    remove: (id) =>
      Effect.sync(() => {
        deleteOne.run(id)
      }),
  }
}

/**
 * 표 `name`에 시드를 한 번만 넣습니다. 넣었으면 `semu_meta`에 `seeded:<name>`을 남기고, 표시가 있으면 다시 넣지 않습니다.
 *
 * 시드가 있는 표만 부릅니다. 시드가 없는 표에는 표시를 남기지 않아, 나중에 시드를 더하면 이미 있는 데이터베이스에도 들어갑니다.
 * 표시가 없는 이전 데이터베이스는 표가 비어 있을 때만 넣고 표시를 남깁니다. 표시 확인·넣기·표시는 한 savepoint 안에서 하고,
 * 표시는 `INSERT OR IGNORE`라 같은 파일을 연 두 프로세스가 겹쳐도 실패하지 않습니다.
 */
function seedOnce(db: import('node:sqlite').DatabaseSync, name: string, insertSeed: () => void): void {
  ensureMetaTable(db)
  const marker = seededMarker(name)
  db.exec('SAVEPOINT semu_seed')
  try {
    if (db.prepare(`SELECT 1 FROM ${META_TABLE} WHERE name = ?`).get(marker) === undefined) {
      const isEmpty = db.prepare(`SELECT NOT EXISTS (SELECT 1 FROM ${name}) AS empty`).get()?.['empty'] === 1
      if (isEmpty) insertSeed()
      db.prepare(`INSERT OR IGNORE INTO ${META_TABLE} (name, value) VALUES (?, ?)`).run(
        marker,
        new Date().toISOString(),
      )
    }
    db.exec('RELEASE semu_seed')
  } catch (error) {
    db.exec('ROLLBACK TO semu_seed')
    db.exec('RELEASE semu_seed')
    throw error
  }
}

/** 회사별로 나뉜 레코드 저장소의 기본 동작입니다. 회사 범위 밖 레코드는 보이지 않습니다. */
export interface TenantTable<T extends TenantRecord> {
  list(companyId: Id<'company'>): Effect.Effect<ReadonlyArray<T>>
  find(companyId: Id<'company'>, id: string): Effect.Effect<Option.Option<T>>
  save(record: T): Effect.Effect<void>
  remove(companyId: Id<'company'>, id: string): Effect.Effect<void>
}

/** {@link TableFactory}로 회사 범위 표를 만듭니다. */
export function makeTenantTable<T extends TenantRecord>(
  name: string,
  seed: ReadonlyArray<T> = [],
): Effect.Effect<TenantTable<T>, never, TableFactory> {
  return Effect.gen(function* () {
    const factory = yield* TableFactory
    const table = yield* factory.make<T>(name, { seed, companyOf: (record) => record.companyId })
    return tenantTableOf(table)
  })
}

/** 메모리 회사 범위 표입니다. 컨텍스트 단위 테스트와 기존 `layerMemory`가 씁니다. */
export function makeMemoryTable<T extends TenantRecord>(seed: ReadonlyArray<T> = []): Effect.Effect<TenantTable<T>> {
  return Effect.map(makeMemoryRecordTable<T>({ seed, companyOf: (record) => record.companyId }), tenantTableOf)
}

function tenantTableOf<T extends TenantRecord>(table: RecordTable<T>): TenantTable<T> {
  return {
    list: (companyId) => table.byCompany(companyId),
    find: (companyId, id) =>
      Effect.map(
        table.get(id),
        Option.filter((record) => record.companyId === companyId),
      ),
    save: (record) => table.put(record),
    remove: (companyId, id) =>
      Effect.flatMap(table.get(id), (found) =>
        Option.isSome(found) && found.value.companyId === companyId ? table.remove(id) : Effect.void,
      ),
  }
}
