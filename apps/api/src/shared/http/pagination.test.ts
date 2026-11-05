import { describe, expect, it } from 'vitest'
import { paginate } from './pagination.ts'

const items = ['a', 'b', 'c', 'd', 'e']

describe('paginate', () => {
  it('walks the list page by page with opaque cursors', () => {
    const first = paginate(items, (item) => item, { limit: 2 })
    expect(first.items).toEqual(['a', 'b'])

    const second = paginate(items, (item) => item, { limit: 2, cursor: first.nextCursor! })
    expect(second.items).toEqual(['c', 'd'])

    const last = paginate(items, (item) => item, { limit: 2, cursor: second.nextCursor! })
    expect(last).toEqual({ items: ['e'] })
  })

  it('counts the total only when asked', () => {
    expect(paginate(items, (item) => item, {}, { includeTotal: true }).totalCount).toBe(5)
    expect(paginate(items, (item) => item, {})).not.toHaveProperty('totalCount')
  })
})
