import { Result } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { AuditInput } from '../audit/audit-log.ts'
import { passwordViolations } from './password-policy.ts'
import { AccountLocked, InvalidCredentials, PasswordPolicyViolated, type UserRecord } from './user.ts'

/**
 * 사용자 애그리거트입니다(docs/design/domain-model.md). 로그인 판정과 비밀번호 변경의 판정 함수(`decide…`)를 둡니다.
 *
 * 판정 함수는 순수 함수입니다. 비밀번호 해시와 대조는 서비스가 하고 결과만 넘깁니다. 비싼 계산이라 판정이 필요하다고 할 때만 합니다:
 * 로그인은 {@link planSignIn}이 통과한 계정만 대조하고, 비밀번호 변경은 {@link planPasswordChange}가 통과해야 새 비밀번호를 해시합니다.
 * 판정은 남길 감사 기록(`audit`)을 함께 돌려주고 서비스가 그대로 남깁니다.
 */

/** 이만큼 연속으로 틀리면 계정을 잠급니다. */
export const MAX_FAILED_SIGN_INS = 5

/** 남길 사용자 변경과 감사 기록입니다. `user`가 없으면 사용자는 그대로입니다. */
export interface UserChange {
  user?: UserRecord
  audit: AuditInput[]
}

/** 거부입니다. `keep`이 있으면 서비스가 저장하고 `keepChanges`를 부른 뒤 `error`로 실패합니다(M1). */
export interface UserRejection<E> {
  error: E
  keep?: UserChange
}

/**
 * 비밀번호를 대조할 계정인지 봅니다. 없는·비활성·데모 계정은 감사 기록을 남기며 `InvalidCredentials`이고, 이미 잠긴 계정은
 * 대조하지 않고 `AccountLocked`입니다.
 */
export function planSignIn(
  found: UserRecord | undefined,
): Result.Result<UserRecord, UserRejection<InvalidCredentials | AccountLocked>> {
  if (found === undefined || found.status !== 'ACTIVE' || found.isDemo) {
    return Result.fail({
      error: new InvalidCredentials({}),
      keep: { audit: [{ action: 'SIGN_IN_FAILED', detail: 'unknown or inactive account' }] },
    })
  }
  if (found.failedSignInCount >= MAX_FAILED_SIGN_INS) return Result.fail({ error: new AccountLocked({}) })
  return Result.succeed(found)
}

/**
 * 로그인을 판정합니다. 틀리면 실패 횟수를 1 올려 남기며 거부하고, 다섯 번째로 틀리면 잠금(`ACCOUNT_LOCKED`)입니다. 맞으면 실패 횟수를
 * 비웁니다(이미 0이면 바꾸지 않음). 로그인 성공 감사 기록은 세션이 묶은 회사가 필요해 세션을 연 뒤 {@link decideSignInSucceeded}로 고릅니다.
 */
export function decideSignIn(
  user: UserRecord,
  passwordMatches: boolean,
): Result.Result<UserChange, UserRejection<InvalidCredentials | AccountLocked>> {
  if (!passwordMatches) {
    const failed = user.failedSignInCount + 1
    const locked = failed >= MAX_FAILED_SIGN_INS
    return Result.fail({
      error: locked ? new AccountLocked({}) : new InvalidCredentials({}),
      keep: {
        user: { ...user, failedSignInCount: failed },
        audit: [{ action: locked ? 'ACCOUNT_LOCKED' : 'SIGN_IN_FAILED', actorUserId: user.id }],
      },
    })
  }
  return Result.succeed(
    user.failedSignInCount > 0 ? { user: { ...user, failedSignInCount: 0 }, audit: [] } : { audit: [] },
  )
}

/** 로그인 성공 감사 기록입니다. 세션을 열어 묶은 회사가 정해진 뒤 서비스가 부릅니다. 회사가 없으면(가입 직후) 회사 없이 남깁니다. */
export function decideSignInSucceeded(user: UserRecord, companyId: Id<'company'> | undefined): AuditInput[] {
  return [{ action: 'SIGN_IN_SUCCEEDED', actorUserId: user.id, companyId }]
}

/**
 * 비밀번호를 바꿀 수 있는지 봅니다. 사용자가 없거나 지금 비밀번호가 틀리면 `InvalidCredentials`, 새 비밀번호가 정책을 어기면
 * `PasswordPolicyViolated`입니다. 서비스는 이것이 통과해야 새 비밀번호를 해시합니다.
 */
export function planPasswordChange(
  user: UserRecord | undefined,
  currentPasswordMatches: boolean,
  newPassword: string,
): Result.Result<UserRecord, InvalidCredentials | PasswordPolicyViolated> {
  if (user === undefined || !currentPasswordMatches) return Result.fail(new InvalidCredentials({}))
  const violations = passwordViolations(newPassword)
  if (violations.length > 0) {
    return Result.fail(
      new PasswordPolicyViolated({ violations: violations.map((code) => ({ field: 'newPassword', code })) }),
    )
  }
  return Result.succeed(user)
}

/** 비밀번호 변경을 판정합니다. 새 해시로 바꾸고 실패 횟수를 비웁니다(잠금 해제). 세션 전부 폐기는 서비스가 같은 트랜잭션에 합니다. */
export function decidePasswordChange(
  user: UserRecord,
  passwordHash: string,
  companyId: Id<'company'> | undefined,
): Required<UserChange> {
  return {
    user: { ...user, passwordHash, failedSignInCount: 0 },
    audit: [{ action: 'PASSWORD_CHANGED', actorUserId: user.id, companyId }],
  }
}
