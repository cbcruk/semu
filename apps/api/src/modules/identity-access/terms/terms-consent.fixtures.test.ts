import { describe, expect, it } from 'vitest'
import type { Plan } from '../actor.types.ts'
import { loadRuleCases } from '../rule-fixtures.ts'
import { applicablePurposes, consentStatus } from './terms-consent.ts'
import type { TermPurpose } from './terms-consent.types.ts'

/**
 * 서버 함수로 옮기지 않는 케이스입니다.
 *
 * - `purposes`의 "소속 회사 중 하나라도": 재설계는 토큰이 묶인 회사로 판정합니다(바꿈). 입력에 지금 회사가 없어 옮기지 않습니다
 * - `guard`: 화면 이동 규칙입니다. 서버는 제품 API에서 403 `TERMS_REAGREEMENT_REQUIRED`로 막습니다
 * - `record`: 서버는 400 대신 422 `REQUIRED_TERM_DECLINED`·409 `TERM_VERSION_OUTDATED`로 답합니다(바꿈). `sessions.http.test.ts`가 확인합니다
 */
const NOT_PORTED = new Set([
  'purposes when any company is taxation',
  'guard redirects to /agree-terms when a signup term needs consent',
  'guard redirects to /tax-agree-terms when only tax terms are pending',
  'guard ignores pending tax terms for a free customer',
  'guard redirects for a new optional term version',
  'guard throws on an empty term list',
  'legacy server refuses to record a declined required term',
  'legacy server refuses an answer to an outdated term id',
])

/** 기대값을 바꾼 케이스입니다. 버전은 문자열로 받으므로 `2`와 `"2"`는 같은 버전입니다. */
const CHANGED: Record<string, unknown> = {
  'version compared with strict inequality across types': false,
}

interface LegacyTerm {
  isRequired: boolean
  version: string | number
  history: { isAgreed: boolean; version: string | number } | null
}

const PURPOSE_OF: Record<TermPurpose, string> = { SIGNUP: 'signup', TAX: 'tax', CONSULTING: 'consulting' }
const AUDIENCE_PURPOSE: Record<string, TermPurpose> = { all: 'SIGNUP', taxation: 'TAX' }

function run(input: Record<string, unknown>): unknown {
  switch (input['check']) {
    case 'needsConsent': {
      const term = input['term'] as LegacyTerm
      const status = consentStatus(
        { code: 'term', version: String(term.version), required: term.isRequired },
        term.history === null ? undefined : { version: String(term.history.version), agreed: term.history.isAgreed },
      )
      return status !== 'SETTLED'
    }
    case 'purposes': {
      const companies = input['companies'] as Array<{ taxPlan: string | null }>
      const plans = new Set<Plan>(companies.some((c) => c.taxPlan === 'taxation') ? ['TAXATION'] : [])
      return applicablePurposes(plans).map((purpose) => PURPOSE_OF[purpose])
    }
    case 'visibleTerms': {
      const plans = new Set<Plan>(input['companyTaxPlan'] === 'taxation' ? ['TAXATION'] : [])
      const purposes = applicablePurposes(plans)
      const terms = input['terms'] as Array<{ code: string; audience: string }>
      return terms.filter((term) => purposes.includes(AUDIENCE_PURPOSE[term.audience] ?? 'SIGNUP')).map((t) => t.code)
    }
    default:
      throw new Error(`unknown check ${String(input['check'])}`)
  }
}

describe('terms-reagreement fixtures', () => {
  for (const testCase of loadRuleCases('terms-reagreement')) {
    it.skipIf(NOT_PORTED.has(testCase.name))(testCase.name, () => {
      const legacy = testCase.expected as { legacyServer?: unknown } | unknown
      const expected =
        testCase.name in CHANGED
          ? CHANGED[testCase.name]
          : typeof legacy === 'object' && legacy !== null && 'legacyServer' in legacy
            ? legacy.legacyServer
            : legacy
      expect(run(testCase.input)).toEqual(expected)
    })
  }
})
