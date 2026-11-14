import { Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import { IdSchema } from '../../../shared/ids/id-schema.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { problemType } from '../../../shared/problem/problem.ts'

/** 지원사업 공고 ID입니다. */
export const GrantId = IdSchema('grant')

/**
 * 정부·지자체 지원사업 공고입니다. 공고 수집 작업(`assistant.grant-feed`)이 매일 04:00에 갱신합니다.
 *
 * 업종 코드는 한국표준산업분류, 지역 코드는 법정동 시·도(2자리) 또는 시·군·구(5자리)입니다. 비어 있으면 제한이 없습니다.
 */
export const Grant = Schema.Struct({
  id: GrantId,
  /** 공고 출처입니다. 예: `BIZINFO`(기업마당) */
  source: Schema.String,
  title: Schema.String,
  /** 주관 기관입니다. */
  agency: Schema.String,
  summary: Schema.String,
  url: Schema.String,
  industryCodes: Schema.Array(Schema.String),
  regionCodes: Schema.Array(Schema.String),
  applyStartOn: Schema.String,
  /** `null`이면 상시 모집입니다. */
  applyEndOn: Schema.NullOr(Schema.String),
})
export type Grant = typeof Grant.Type

/** 저장된 공고입니다. */
export interface GrantRecord extends Grant {
  id: Id<'grant'>
  /** 원천의 공고 번호입니다. 공고 수집이 같은 공고를 찾는 데 씁니다. 응답에는 넣지 않습니다. */
  externalId?: string | undefined
}

/** 공고가 없습니다. */
export class GrantNotFound extends HttpApiError.Problem<GrantNotFound>()(
  'GrantNotFound',
  { type: problemType('GRANT_NOT_FOUND'), status: 404, title: 'Grant not found' },
  { code: Schema.tag('GRANT_NOT_FOUND') },
) {}
