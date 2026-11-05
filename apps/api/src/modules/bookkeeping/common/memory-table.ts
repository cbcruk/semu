import { Effect, Option, Ref } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'

/** 회사에 속한 저장 행입니다. `companyId`가 `null`이면 모든 회사가 함께 보는 기본 행입니다. */
export interface CompanyRow {
  readonly id: string
  readonly companyId: Id<'company'> | null
}

/** 회사 범위 행을 다루는 저장소 연산입니다. 컨텍스트의 저장소 서비스가 이 모양을 씁니다. */
export interface Table<A extends CompanyRow> {
  /** 회사의 행 하나입니다. 다른 회사 행이면 `None`입니다. 기본 행(`companyId: null`)은 모든 회사가 봅니다. */
  findById(companyId: Id<'company'>, id: A['id']): Effect.Effect<Option.Option<A>>
  /** 회사가 보는 행 전체입니다. 저장한 순서를 지킵니다. */
  list(companyId: Id<'company'>): Effect.Effect<ReadonlyArray<A>>
  /** 행을 넣거나 바꿉니다. */
  save(row: A): Effect.Effect<void>
  /** 여러 행을 한 번에 넣거나 바꿉니다. 메모리 구현은 원자적입니다. */
  saveAll(rows: ReadonlyArray<A>): Effect.Effect<void>
  /** 행을 지웁니다. 없으면 아무 일도 하지 않습니다. */
  remove(companyId: Id<'company'>, id: A['id']): Effect.Effect<void>
}

/** 프로세스 메모리에 행을 두는 {@link Table}을 만듭니다. `seed`로 시작합니다. */
export function memoryTable<A extends CompanyRow>(seed: ReadonlyArray<A> = []): Effect.Effect<Table<A>> {
  return Effect.map(Ref.make(new Map<string, A>(seed.map((row) => [row.id, row]))), (store) => {
    const visible = (companyId: Id<'company'>, row: A): boolean => row.companyId === null || row.companyId === companyId
    return {
      findById: (companyId, id) =>
        Ref.get(store).pipe(
          Effect.map((rows) => Option.filter(Option.fromNullishOr(rows.get(id)), (row) => visible(companyId, row))),
        ),
      list: (companyId) =>
        Ref.get(store).pipe(Effect.map((rows) => [...rows.values()].filter((row) => visible(companyId, row)))),
      save: (row) => Ref.update(store, (rows) => new Map(rows).set(row.id, row)),
      saveAll: (saved) =>
        Ref.update(store, (rows) => {
          const next = new Map(rows)
          for (const row of saved) next.set(row.id, row)
          return next
        }),
      remove: (companyId, id) =>
        Ref.update(store, (rows) => {
          const row = rows.get(id)
          if (row === undefined || row.companyId !== companyId) return rows
          const next = new Map(rows)
          next.delete(id)
          return next
        }),
    }
  })
}
