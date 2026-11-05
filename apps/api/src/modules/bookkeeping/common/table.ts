import { Effect, Option } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { TableFactory } from '../../../shared/persistence/record-table.ts'

/** 회사에 속한 저장 행입니다. `companyId`가 `null`이면 모든 회사가 함께 보는 기본 행입니다. */
export interface CompanyRow {
  readonly id: string
  readonly companyId: Id<'company'> | null
}

/** 회사 범위 행을 다루는 저장소 연산입니다. 컨텍스트의 저장소 서비스가 이 모양을 씁니다. */
export interface Table<A extends CompanyRow> {
  /** 회사의 행 하나입니다. 다른 회사 행이면 `None`입니다. 기본 행(`companyId: null`)은 모든 회사가 봅니다. */
  findById(companyId: Id<'company'>, id: A['id']): Effect.Effect<Option.Option<A>>
  /** 회사가 보는 행 전체입니다. 코드에 둔 기본 행, 저장한 기본 행, 회사 행 순이고, 저장한 행은 ID(만든) 순입니다. */
  list(companyId: Id<'company'>): Effect.Effect<ReadonlyArray<A>>
  /** 행을 넣거나 바꿉니다. */
  save(row: A): Effect.Effect<void>
  /** 여러 행을 넣거나 바꿉니다. 요청 트랜잭션 안이면 함께 커밋되거나 함께 되돌려집니다. */
  saveAll(rows: ReadonlyArray<A>): Effect.Effect<void>
  /** 회사 행을 지웁니다. 없거나 다른 회사·기본 행이면 아무 일도 하지 않습니다. */
  remove(companyId: Id<'company'>, id: A['id']): Effect.Effect<void>
}

/** 저장한 기본 행(`companyId: null`)을 모으는 회사 키입니다. 회사 ID 형식(`cmp_...`)과 겹치지 않습니다. */
const SHARED_KEY = '*' as Id<'company'>

/** {@link bookkeepingTable}의 설정입니다. */
export interface BookkeepingTableOptions<A extends CompanyRow> {
  /** 표가 비어 있을 때 넣을 행입니다. SQLite는 같은 ID가 없을 때만 넣습니다. */
  readonly seed?: ReadonlyArray<A>
  /** 코드에 둔 기본 행입니다. 표에 저장하지 않고 모든 회사가 읽기만 합니다. */
  readonly builtIn?: ReadonlyArray<A>
}

/**
 * `name` 표 위에 {@link Table}을 만듭니다. 저장 방식(메모리·SQLite)은 {@link TableFactory}가 정합니다.
 *
 * 회사 행은 회사 색인으로, 저장한 기본 행은 {@link SHARED_KEY}로 찾습니다. 트랜잭션은 열지 않습니다. 요청의 `UnitOfWork`를 따릅니다.
 */
export function bookkeepingTable<A extends CompanyRow>(
  name: string,
  options: BookkeepingTableOptions<A> = {},
): Effect.Effect<Table<A>, never, TableFactory> {
  return Effect.gen(function* () {
    const table = yield* (yield* TableFactory).make<A>(name, {
      seed: options.seed ?? [],
      companyOf: (row) => row.companyId ?? SHARED_KEY,
    })
    const builtIn = options.builtIn ?? []
    const builtInById = new Map(builtIn.map((row) => [row.id, row]))
    const visible = (companyId: Id<'company'>, row: A): boolean => row.companyId === null || row.companyId === companyId

    return {
      findById: (companyId, id) => {
        const fixed = builtInById.get(id)
        if (fixed !== undefined) return Effect.succeed(Option.some(fixed))
        return Effect.map(
          table.get(id),
          Option.filter((row) => visible(companyId, row)),
        )
      },
      list: (companyId) =>
        Effect.gen(function* () {
          const shared = yield* table.byCompany(SHARED_KEY)
          const own = yield* table.byCompany(companyId)
          return [...builtIn, ...shared, ...own]
        }),
      save: (row) => table.put(row),
      saveAll: (rows) => Effect.forEach(rows, (row) => table.put(row), { discard: true }),
      remove: (companyId, id) =>
        Effect.flatMap(table.get(id), (found) =>
          Option.isSome(found) && found.value.companyId === companyId ? table.remove(id) : Effect.void,
        ),
    }
  })
}
