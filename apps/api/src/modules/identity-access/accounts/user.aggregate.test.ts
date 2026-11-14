import { Result } from 'effect'
import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import {
  decidePasswordChange,
  decideSignIn,
  decideSignInSucceeded,
  MAX_FAILED_SIGN_INS,
  planPasswordChange,
  planSignIn,
} from './user.aggregate.ts'
import type { UserRecord } from './user.ts'

const user: UserRecord = {
  id: 'usr_01JBQ000000000000000000001' as Id<'user'>,
  email: 'owner@example.com',
  name: '대표',
  kind: 'CLIENT',
  isDemo: false,
  passwordHash: 'old-hash',
  status: 'ACTIVE',
  failedSignInCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
}

describe('planSignIn', () => {
  it('없는·비활성·데모 계정은 감사 기록만 남기며 자격 증명 오류입니다', () => {
    for (const found of [undefined, { ...user, status: 'DEACTIVATED' as const }, { ...user, isDemo: true }]) {
      const result = planSignIn(found)

      expect(Result.isFailure(result) && result.failure.error._tag).toBe('InvalidCredentials')
      expect(Result.isFailure(result) && result.failure.keep).toEqual({
        audit: [{ action: 'SIGN_IN_FAILED', detail: 'unknown or inactive account' }],
      })
    }
  })

  it('이미 잠긴 계정은 비밀번호를 대조하지 않고 잠금이며 남길 것이 없습니다', () => {
    const result = planSignIn({ ...user, failedSignInCount: MAX_FAILED_SIGN_INS })

    expect(Result.isFailure(result) && result.failure).toEqual({
      error: expect.objectContaining({ _tag: 'AccountLocked' }),
    })
  })
})

describe('decideSignIn', () => {
  it('틀리면 실패 횟수를 올려 남기며 거부하고 다섯 번째에 잠급니다', () => {
    const fourth = decideSignIn({ ...user, failedSignInCount: 3 }, false)
    const fifth = decideSignIn({ ...user, failedSignInCount: 4 }, false)

    expect(Result.isFailure(fourth) && fourth.failure).toMatchObject({
      error: { _tag: 'InvalidCredentials' },
      keep: { user: { failedSignInCount: 4 }, audit: [{ action: 'SIGN_IN_FAILED', actorUserId: user.id }] },
    })
    expect(Result.isFailure(fifth) && fifth.failure).toMatchObject({
      error: { _tag: 'AccountLocked' },
      keep: { user: { failedSignInCount: 5 }, audit: [{ action: 'ACCOUNT_LOCKED' }] },
    })
  })

  it('맞으면 실패 횟수를 비우고, 이미 0이면 사용자를 바꾸지 않습니다', () => {
    expect(Result.getOrThrow(decideSignIn({ ...user, failedSignInCount: 2 }, true)).user?.failedSignInCount).toBe(0)
    expect(Result.getOrThrow(decideSignIn(user, true))).toEqual({ audit: [] })
  })
})

describe('decideSignInSucceeded', () => {
  it('세션이 묶은 회사로 로그인 성공을 남기고, 회사가 없으면 회사 없이 남깁니다', () => {
    const company = 'cmp_01JBQ00000000000000000000A' as Id<'company'>

    expect(decideSignInSucceeded(user, company)).toEqual([
      { action: 'SIGN_IN_SUCCEEDED', actorUserId: user.id, companyId: company },
    ])
    expect(decideSignInSucceeded(user, undefined)).toEqual([
      { action: 'SIGN_IN_SUCCEEDED', actorUserId: user.id, companyId: undefined },
    ])
  })
})

describe('비밀번호 변경', () => {
  it('지금 비밀번호가 틀리면 정책보다 먼저 자격 증명 오류입니다', () => {
    const result = planPasswordChange(user, false, 'short')

    expect(Result.isFailure(result) && result.failure._tag).toBe('InvalidCredentials')
  })

  it('새 비밀번호가 정책을 어기면 newPassword 필드로 알려 줍니다', () => {
    const result = planPasswordChange(user, true, 'short')

    expect(Result.isFailure(result) && result.failure).toMatchObject({
      _tag: 'PasswordPolicyViolated',
      violations: expect.arrayContaining([{ field: 'newPassword', code: 'PASSWORD_LENGTH' }]),
    })
  })

  it('새 해시로 바꾸고 잠금을 풀며 변경 감사 기록을 남깁니다', () => {
    const company = 'cmp_01JBQ00000000000000000000A' as Id<'company'>
    const change = decidePasswordChange({ ...user, failedSignInCount: 5 }, 'new-hash', company)

    expect(change.user).toMatchObject({ passwordHash: 'new-hash', failedSignInCount: 0 })
    expect(change.audit).toEqual([{ action: 'PASSWORD_CHANGED', actorUserId: user.id, companyId: company }])
  })
})
