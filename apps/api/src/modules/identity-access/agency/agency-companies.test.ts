import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { AgentCompany } from '../actor.types.ts'
import { AgencyCompanies } from './agency-companies.ts'
import { AgencyWorkload } from './agency-workload.ts'

function company(n: number, name: string): AgentCompany {
  return {
    companyId: `cmp_01JBQ0000000000000000000${String(n).padStart(2, '0')}` as Id<'company'>,
    name,
    businessType: 'CORPORATION',
    plans: new Set(['TAXATION']),
    assigneeIds: [],
  }
}

/** `limit=1`로 끝까지 넘기며 본 회사 이름입니다. */
function walk(companies: ReadonlyArray<AgentCompany>): Promise<string[]> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* AgencyCompanies
      const names: string[] = []
      let cursor: string | undefined
      for (let guard = 0; guard <= companies.length; guard += 1) {
        const page = yield* service.list(companies, { limit: 1, ...(cursor === undefined ? {} : { cursor }) })
        names.push(...page.items.map((item) => item.name))
        if (page.nextCursor === undefined) break
        cursor = page.nextCursor
      }
      return names
    }).pipe(Effect.provide(AgencyCompanies.layer), Effect.provide(AgencyWorkload.layerEmpty)),
  )
}

describe('AgencyCompanies.list paging', () => {
  it.each([
    [
      ['세무 상점', '세무'],
      ['세무', '세무 상점'],
    ],
    [
      ['apple', 'Banana'],
      ['Banana', 'apple'],
    ],
    [
      ['세무', '세무 상점', 'apple', 'Banana', '세무 상점'],
      ['Banana', 'apple', '세무', '세무 상점', '세무 상점'],
    ],
  ])('visits every company exactly once with limit=1 (%j)', async (names, expected) => {
    const companies = names.map((name, index) => company(index + 1, name))

    expect(await walk(companies)).toEqual(expected)
  })
})
