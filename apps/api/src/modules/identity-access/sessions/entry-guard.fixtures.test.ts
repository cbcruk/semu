import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { AccessibleCompany } from '../access/actor-directory.ts'
import type { Company } from '../companies/company.ts'
import { loadRuleCases } from '../rule-fixtures.ts'
import { chooseCompany } from './sessions.ts'

/**
 * 진입 가드의 화면 이동(`guard`)과 nexus·sf 프로필 합치기(`initialize`)는 재설계에서 사라집니다.
 * 로그인 응답 하나가 사용자·회사·약관 상태를 함께 주고, 제품 API가 401·403으로 막습니다.
 * 회사 고르기(`selectCompany`)만 서버의 {@link chooseCompany}로 옮깁니다.
 */
const PORTED_CHECK = 'selectCompany'

/**
 * 기대값을 바꾼 케이스입니다.
 *
 * - 쿼리 ID는 로그인·전환 요청의 `companyId` 하나로 합칩니다. sf ID는 없습니다
 * - 접근할 수 없는 회사를 요청하면 다음 후보로 넘어가지 않고 404입니다
 * - 기본 회사는 목록의 마지막이 아니라 마지막으로 쓴 회사, 없으면 가장 먼저 소속된 회사입니다
 */
const CHANGED: Record<string, unknown> = {
  'company from the sf id query wins over everything': { companyId: 12 },
  'last company when nothing else is set': { companyId: 11 },
  'query id the user does not belong to falls through': 'NOT_FOUND',
}

interface LegacyCompany {
  id: number
  sfCompanyId: number
}

function companyId(legacyId: number | string): Id<'company'> {
  return `cmp_${String(legacyId).padStart(26, '0')}` as Id<'company'>
}

function run(input: Record<string, unknown>): unknown {
  const companies = (input['companies'] as LegacyCompany[]).map((legacy): AccessibleCompany => ({
    company: { id: companyId(legacy.id) } as Company,
    actorKind: 'CLIENT',
  }))
  const query = input['query'] as { _company_id?: string; _nexus_company_id?: string }
  const sfMatch = (input['companies'] as LegacyCompany[]).find((c) => String(c.sfCompanyId) === query._company_id)
  const requestedLegacy = sfMatch?.id ?? query._nexus_company_id
  const cookie = input['cookie'] as string | null
  const chosen = chooseCompany(
    companies,
    requestedLegacy === undefined ? undefined : companyId(requestedLegacy),
    cookie === null ? undefined : companyId(cookie),
  )
  if (chosen === 'NOT_FOUND' || chosen === undefined) return chosen ?? null
  return { companyId: Number(chosen.company.id.slice(4)) }
}

describe('entry-guard-order fixtures', () => {
  for (const testCase of loadRuleCases('entry-guard-order')) {
    it.skipIf(testCase.input['check'] !== PORTED_CHECK)(testCase.name, () => {
      const expected = CHANGED[testCase.name] ?? testCase.expected
      const actual = run(testCase.input)
      if (typeof expected === 'object' && expected !== null) expect(actual).toMatchObject(expected)
      else expect(actual).toEqual(expected)
    })
  }
})
