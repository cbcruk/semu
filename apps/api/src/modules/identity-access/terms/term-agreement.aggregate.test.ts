import { Result } from 'effect'
import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { testActor } from '../testing.ts'
import { decideSignupAgreements, decideTermResponses } from './term-agreement.aggregate.ts'
import type { Term } from './term.ts'

const actor = testActor()
const at = '2026-11-15T00:00:00.000Z'
const term = (id: string, code: string, required: boolean): Term => ({
  id: id as Id<'term'>,
  code,
  purpose: 'SIGNUP',
  title: code,
  contentUrl: `https://example.com/${code}`,
  version: '2026-01',
  required,
  effectiveFrom: '2026-01-01',
})
const service = term('trm_01JBQ000000000000000000001', 'SERVICE', true)
const marketing = term('trm_01JBQ000000000000000000002', 'MARKETING', false)
const old = 'trm_01JBQ000000000000000000009' as Id<'term'>

describe('decideTermResponses', () => {
  it('응답마다 지금 버전의 동의 기록을 남기고 응답 내용을 감사 기록에 담습니다', () => {
    const decision = Result.getOrThrow(
      decideTermResponses(
        [service, marketing],
        [
          { termId: service.id, agreed: true },
          { termId: marketing.id, agreed: false },
        ],
        actor,
        at,
      ),
    )

    expect(decision.agreements).toEqual([
      { userId: actor.userId, termId: service.id, code: 'SERVICE', version: '2026-01', agreed: true, decidedAt: at },
      {
        userId: actor.userId,
        termId: marketing.id,
        code: 'MARKETING',
        version: '2026-01',
        agreed: false,
        decidedAt: at,
      },
    ])
    expect(decision.audit).toEqual([
      expect.objectContaining({ action: 'TERMS_DECIDED', detail: `${service.id}=AGREED,${marketing.id}=DECLINED` }),
    ])
  })

  it('지금 버전이 아닌 약관은 필수 약관 거절보다 먼저 알려 줍니다', () => {
    const result = decideTermResponses(
      [service],
      [
        { termId: service.id, agreed: false },
        { termId: old, agreed: true },
      ],
      actor,
      at,
    )
    const declined = decideTermResponses([service], [{ termId: service.id, agreed: false }], actor, at)

    expect(Result.isFailure(result) && result.failure).toMatchObject({ _tag: 'TermVersionOutdated', termIds: [old] })
    expect(Result.isFailure(declined) && declined.failure).toMatchObject({
      _tag: 'RequiredTermDeclined',
      termCodes: ['SERVICE'],
    })
  })
})

describe('decideSignupAgreements', () => {
  const user = 'usr_01JBQ000000000000000000009' as Id<'user'>

  it('가입 약관마다 기록하고 고르지 않은 선택 약관은 거절로 남깁니다', () => {
    const decision = Result.getOrThrow(decideSignupAgreements([service, marketing], [service.id], user, at))

    expect(decision.agreements.map((agreement) => [agreement.code, agreement.agreed])).toEqual([
      ['SERVICE', true],
      ['MARKETING', false],
    ])
  })

  it('모르는 약관 ID가 있으면, 없으면 빠진 필수 약관이 있으면 거부합니다', () => {
    const unknown = decideSignupAgreements([service], [old], user, at)
    const missing = decideSignupAgreements([service, marketing], [marketing.id], user, at)

    expect(Result.isFailure(unknown) && unknown.failure).toMatchObject({ _tag: 'TermVersionOutdated', termIds: [old] })
    expect(Result.isFailure(missing) && missing.failure).toMatchObject({
      _tag: 'RequiredTermsMissing',
      termCodes: ['SERVICE'],
    })
  })
})
