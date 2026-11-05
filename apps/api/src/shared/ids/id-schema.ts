import { Schema } from 'effect'
import { isId } from './ids.ts'
import type { Id, IdKind } from './ids.types.ts'

/**
 * 주어진 종류의 ID만 통과시키는 스키마입니다. 경로·본문에서 다른 종류의 ID가 오면 400 `INVALID_VALUE`입니다.
 *
 * @example 직원 ID 경로 변수
 * ```ts
 * const params = { employeeId: IdSchema('employee') }
 * ```
 */
export function IdSchema<K extends IdKind>(kind: K) {
  return Schema.String.pipe(Schema.refine((value): value is Id<K> => isId(kind, value)))
}
