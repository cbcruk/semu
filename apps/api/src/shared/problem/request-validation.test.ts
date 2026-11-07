import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { toViolations } from './request-validation.ts'

const Payment = Schema.Struct({ amount: Schema.Int, method: Schema.Literals(['CARD', 'CASH']) })
const Checkout = Schema.Struct({ payments: Schema.Array(Payment), memo: Schema.optionalKey(Schema.String) })

function violationsOf(input: unknown) {
  const result = Schema.decodeUnknownExit(Checkout)(input, { errors: 'all' })
  if (result._tag !== 'Failure') throw new Error('expected decoding to fail')
  const issue = result.cause.reasons.find((reason) => reason._tag === 'Fail')?.error.issue
  if (issue === undefined) throw new Error('expected a schema issue')
  return toViolations(issue, 'body')
}

describe('요청 검증 위반 목록', () => {
  it('중첩 경로를 JSON 경로로 나타냅니다', () => {
    expect(
      violationsOf({
        payments: [
          { amount: 1000, method: 'CARD' },
          { amount: 1.5, method: 'BANK' },
        ],
      }),
    ).toEqual([
      { field: 'payments[1].amount', code: 'INVALID_VALUE' },
      { field: 'payments[1].method', code: 'INVALID_VALUE' },
    ])
  })

  it('빠진 필드와 형이 틀린 필드를 짚습니다', () => {
    expect(violationsOf({ memo: 3 })).toEqual([
      { field: 'payments', code: 'REQUIRED' },
      { field: 'memo', code: 'INVALID_TYPE' },
    ])
  })

  it('값 전체가 틀리면 요청 부분 이름(body 등)을 필드로 씁니다', () => {
    expect(violationsOf('not an object')).toEqual([{ field: 'body', code: 'INVALID_TYPE' }])
  })
})
