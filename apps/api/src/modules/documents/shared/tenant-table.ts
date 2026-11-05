import { Effect, Option, Ref } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'

/** 회사(테넌트)에 속한 저장 레코드입니다. */
export interface TenantRecord {
  readonly id: string
  readonly companyId: Id<'company'>
}

/** 회사별로 나뉜 레코드 저장소의 기본 동작입니다. 목록은 ID(ULID) 순, 곧 만든 순입니다. */
export interface TenantTable<T extends TenantRecord> {
  list(companyId: Id<'company'>): Effect.Effect<ReadonlyArray<T>>
  find(companyId: Id<'company'>, id: string): Effect.Effect<Option.Option<T>>
  save(record: T): Effect.Effect<void>
  remove(companyId: Id<'company'>, id: string): Effect.Effect<void>
  /** 회사와 상관없이 조건에 맞는 첫 레코드입니다. 비로그인 링크(토큰)로 찾을 때만 씁니다. */
  findAcrossCompanies(predicate: (record: T) => boolean): Effect.Effect<Option.Option<T>>
}

/** `seed`로 시작해 프로세스 메모리에 레코드를 보관하는 {@link TenantTable}을 만듭니다. */
export function makeMemoryTable<T extends TenantRecord>(seed: ReadonlyArray<T> = []): Effect.Effect<TenantTable<T>> {
  return Effect.map(Ref.make(new Map(seed.map((record) => [record.id, record]))), (store) => ({
    list: (companyId) =>
      Ref.get(store).pipe(
        Effect.map((records) =>
          [...records.values()]
            .filter((record) => record.companyId === companyId)
            .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
        ),
      ),
    find: (companyId, id) =>
      Ref.get(store).pipe(
        Effect.map((records) =>
          Option.filter(Option.fromNullishOr(records.get(id)), (record) => record.companyId === companyId),
        ),
      ),
    findAcrossCompanies: (predicate) =>
      Ref.get(store).pipe(Effect.map((records) => Option.fromNullishOr([...records.values()].find(predicate)))),
    save: (record) => Ref.update(store, (records) => new Map(records).set(record.id, record)),
    remove: (companyId, id) =>
      Ref.update(store, (records) => {
        if (records.get(id)?.companyId !== companyId) return records
        const next = new Map(records)
        next.delete(id)
        return next
      }),
  }))
}

/** 값이 `undefined`인 키를 지웁니다. 선택 필드를 응답 스키마(`optionalKey`)에 맞출 때 씁니다. */
export function stripUndefined<T extends object>(value: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>
  }
}
