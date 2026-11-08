import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkChannelToken } from './channel-token.ts'
import type { ChannelTokenRejection, StoredChannelToken } from './channel-token.ts'

/**
 * 현행 픽스처(`test/fixtures/rules/chat-channel-token.json`)를 서버 토큰 판정으로 옮긴 테스트입니다.
 *
 * 현행 영어 문장(`token is invalid|used|expired`)은 오류 코드 `CHAT_CHANNEL_TOKEN_INVALID|USED|EXPIRED`가 됩니다.
 */

interface FixtureCase {
  name: string
  input: Record<string, any>
  expected: any
}

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../../../test/fixtures/rules/chat-channel-token.json'), 'utf8'),
) as { cases: FixtureCase[] }

const REASONS: Record<string, ChannelTokenRejection> = {
  'token is invalid': 'INVALID',
  'token is used': 'USED',
  'token is expired': 'EXPIRED',
}

function stored(raw: any): StoredChannelToken | undefined {
  if (raw.exists === false) return undefined
  return {
    expiresAt: Date.parse(raw.expiresAt),
    ...(raw.usedAt === null || raw.usedAt === undefined ? {} : { usedAt: Date.parse(raw.usedAt) }),
  }
}

/** 서버 테스트로 옮기지 않은 케이스와 그 이유입니다. */
const NOT_PORTED: Record<string, string> = {
  'link with action=chat-integration starts the flow': '링크 쿼리를 읽는 일은 클라이언트 라우팅입니다',
  'link with another action is ignored': '링크 쿼리를 읽는 일은 클라이언트 라우팅입니다',
  'connect to a company the user does not belong to is refused and leaves the token unused':
    '연결할 회사는 로그인한 회사(토큰)로 정해지므로 소속 아닌 회사로 연결하는 요청이 생기지 않습니다',
  'client shows the message chosen by the failReason string':
    '문장 대신 오류 코드로 구분합니다. HTTP 테스트가 코드를 검사합니다',
}

const ported = fixture.cases.filter((testCase) => !(testCase.name in NOT_PORTED))

describe('상담 채널 연결 토큰 규칙 픽스처', () => {
  it.each(ported.map((testCase) => [testCase.name, testCase] as const))('%s', (_, testCase) => {
    const rejection = checkChannelToken(stored(testCase.input['token']), Date.parse(testCase.input['now']))
    const failReason = testCase.expected.failReason as string | undefined

    expect(rejection).toBe(failReason === undefined ? undefined : REASONS[failReason])
  })

  it('옮기지 않은 케이스는 모두 이유를 적습니다', () => {
    const names = new Set(ported.map((testCase) => testCase.name))
    const rest = fixture.cases.map((testCase) => testCase.name).filter((name) => !names.has(name))

    expect(rest.sort()).toEqual(Object.keys(NOT_PORTED).sort())
  })
})
