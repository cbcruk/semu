import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CertificateStatus } from '../certificates/certificate-eligibility.types.ts'
import type { AuthMethod } from '../institutions/institution.ts'
import { isRetryable, retryableItemKeys } from './scrap-retry.ts'
import type { LastScrapOutcome } from './scrap-retry.ts'

/**
 * 현행 픽스처(`test/fixtures/rules/scrap-retryable.json`)를 서버 재시도 규칙으로 옮긴 테스트입니다.
 *
 * 현행 클라이언트는 기관 종류마다 판정식이 달랐습니다. 서버는 연동(또는 항목) 하나마다 같은 식 하나로 판정합니다
 * (`docs/design/rule-decisions/integrations.md`의 scrap-retryable). 연동이 둘이면 결과도 둘입니다.
 */

interface FixtureCase {
  name: string
  input: Record<string, any>
  expected: any
}

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../../../test/fixtures/rules/scrap-retryable.json'), 'utf8'),
) as { cases: FixtureCase[] }

function lastOf(raw: any): LastScrapOutcome | undefined {
  if (raw === null || raw === undefined) return undefined
  return { status: raw.isRetryable ? 'SUCCEEDED' : 'FAILED', isRetryable: raw.isRetryable }
}

function authOf(type: string, entry: any): AuthMethod {
  if (entry.authType === 'ID') return 'ID_PASSWORD'
  if (entry.authType === 'CERTIFICATE' || entry.certificate !== undefined) return 'CERTIFICATE'
  if (type === 'pg') return 'API_KEY'
  if (type === 'allra') return 'OAUTH'
  return 'ID_PASSWORD'
}

function input(type: string, entry: any, last: any) {
  const certificate = entry.certificate as CertificateStatus | null | undefined
  const lastScrap = lastOf(last)
  return {
    authMethod: authOf(type, entry),
    ...(certificate === null || certificate === undefined ? {} : { certificateStatus: certificate }),
    ...(lastScrap === undefined ? {} : { lastScrap }),
  }
}

/** 클라이언트 케이스를 서버 판정으로 계산합니다. 연동·항목마다 결과 하나입니다. */
function serverDecision(testCase: FixtureCase): unknown {
  const { side, type, entries } = testCase.input
  if (side === 'server') {
    const authMethod: AuthMethod =
      testCase.input['integration'].authType === 'certificate'
        ? 'CERTIFICATE'
        : testCase.input['integration'].authType === 'api_key'
          ? 'API_KEY'
          : 'ID_PASSWORD'
    const certificate = testCase.input['certificate'] as CertificateStatus | null
    const lastScrap = lastOf(testCase.input['lastStatus'])
    return isRetryable({
      authMethod,
      ...(certificate === null ? {} : { certificateStatus: certificate }),
      ...(lastScrap === undefined ? {} : { lastScrap }),
    })
  }
  if (type === 'bank') {
    const entry = entries[0]
    return {
      retryableAccounts: retryableItemKeys(
        { authMethod: 'CERTIFICATE', certificateStatus: entry.certificate },
        entry.accounts.map((account: any) => ({
          key: account.id,
          isActive: account.isActive,
          ...(lastOf(account.lastScrapping) === undefined ? {} : { lastScrap: lastOf(account.lastScrapping) }),
        })),
      ),
    }
  }
  if (type === 'allra') {
    return entries[0].scm.map((scm: any) => isRetryable(input(type, {}, scm.lastScrapping)))
  }
  const results = entries.map((entry: any) => isRetryable(input(type, entry, entry.lastScrapping)))
  return results.length === 1 ? results[0] : results
}

/** 현행과 달라지는 케이스의 서버 기대값입니다. */
const CHANGED: Record<string, unknown> = {
  'client hometax: certificate only, UNREGISTERED is not checked -> lastScrapping decides': false,
  'client hometax: ID and certificate both, ID side decides even when the certificate expired': [true, false],
  'client pg: value as-is, missing lastScrapping is falsy': true,
}

describe('수집 재시도 가능 규칙 픽스처', () => {
  it.each(fixture.cases.map((testCase) => [testCase.name, testCase] as const))('%s', (name, testCase) => {
    expect(serverDecision(testCase)).toEqual(name in CHANGED ? CHANGED[name] : testCase.expected)
  })
})
