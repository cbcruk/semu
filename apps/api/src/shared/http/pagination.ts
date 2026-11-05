import { Schema } from 'effect'

/** 목록 한 번에 돌려줄 수 있는 최대 항목 수입니다. */
export const MAX_PAGE_SIZE = 200

/** `limit`이 없을 때의 항목 수입니다. */
export const DEFAULT_PAGE_SIZE = 50

/**
 * 커서 목록 쿼리의 공통 필드입니다. 리소스별 필터와 합쳐 엔드포인트의 `query`에 씁니다.
 *
 * @example 직원 목록 쿼리
 * ```ts
 * const query = Schema.Struct({ ...PageQueryFields, status: Schema.optionalKey(EmployeeStatus) })
 * ```
 */
export const PageQueryFields = {
  /** 1–200, 기본 50입니다. */
  limit: Schema.optionalKey(
    Schema.NumberFromString.pipe(
      Schema.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: MAX_PAGE_SIZE })),
    ),
  ),
  /** 앞 응답의 `nextCursor`입니다. */
  cursor: Schema.optionalKey(Schema.String),
}

/** {@link PageQueryFields}로 받은 값입니다. */
export interface PageQuery {
  readonly limit?: number
  readonly cursor?: string
}

/** 커서 목록 응답 스키마를 만듭니다. `nextCursor`가 없으면 마지막 페이지입니다. */
export function Page<S extends Schema.Top>(item: S) {
  return Schema.Struct({
    items: Schema.Array(item),
    nextCursor: Schema.optionalKey(Schema.String),
    totalCount: Schema.optionalKey(Schema.Int),
  })
}

/** 커서 목록 응답 값입니다. */
export interface PageOf<A> {
  items: A[]
  nextCursor?: string
  totalCount?: number
}

/**
 * 정렬된 배열에서 한 페이지를 자릅니다. 메모리 저장소가 씁니다.
 *
 * 커서는 마지막 항목의 정렬 키를 base64url로 감싼 불투명 문자열입니다. 항목이 그 사이 지워져도
 * 정렬 키 기준으로 이어서 읽으므로 건너뛰거나 겹치지 않습니다.
 */
export function paginate<A>(
  sorted: ReadonlyArray<A>,
  sortKey: (item: A) => string,
  query: PageQuery,
  options: { includeTotal?: boolean } = {},
): PageOf<A> {
  const limit = query.limit ?? DEFAULT_PAGE_SIZE
  const after = query.cursor === undefined ? undefined : decodeCursor(query.cursor)
  const start = after === undefined ? 0 : sorted.findIndex((item) => sortKey(item) > after)
  const rest = start < 0 ? [] : sorted.slice(start)
  const items = rest.slice(0, limit)
  const last = items.at(-1)
  return {
    items,
    ...(rest.length > limit && last !== undefined ? { nextCursor: encodeCursor(sortKey(last)) } : {}),
    ...(options.includeTotal === true ? { totalCount: sorted.length } : {}),
  }
}

function encodeCursor(key: string): string {
  return Buffer.from(key, 'utf8').toString('base64url')
}

function decodeCursor(cursor: string): string {
  return Buffer.from(cursor, 'base64url').toString('utf8')
}
