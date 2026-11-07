import { describe, expect, it } from 'vitest'
import { paginate } from './pagination.ts'

const items = ['a', 'b', 'c', 'd', 'e']

describe('페이지 나누기', () => {
  it('불투명 커서로 목록을 한 페이지씩 넘깁니다', () => {
    const first = paginate(items, (item) => item, { limit: 2 })
    expect(first.items).toEqual(['a', 'b'])

    const second = paginate(items, (item) => item, { limit: 2, cursor: first.nextCursor! })
    expect(second.items).toEqual(['c', 'd'])

    const last = paginate(items, (item) => item, { limit: 2, cursor: second.nextCursor! })
    expect(last).toEqual({ items: ['e'] })
  })

  it('요청할 때만 전체 개수를 셉니다', () => {
    expect(paginate(items, (item) => item, {}, { includeTotal: true }).totalCount).toBe(5)
    expect(paginate(items, (item) => item, {})).not.toHaveProperty('totalCount')
  })
})
