import { Clock, Effect, Option } from 'effect'
import { paginate, type PageOf, type PageQuery } from '../../../shared/http/pagination.ts'
import { checkVersion } from '../../../shared/http/versioning.ts'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { PersonalDataAccessLog } from '../../../shared/personal-data/personal-data-access-log.ts'
import { PersonalDataCipher } from '../../../shared/personal-data/personal-data-cipher.ts'
import type { VersionMismatch } from '../../../shared/problem/problem.ts'
import type { CurrentActor } from '../../identity-access/actor.ts'
import type { Actor } from '../../identity-access/actor.types.ts'
import { authorize, type AccessDenied } from '../../identity-access/authorization.ts'
import { PayrollLedgerRepository } from '../ledgers/payroll-ledger-repository.ts'
import { LEDGER_PLANS } from '../payroll-access.ts'
import { EarnerDuplicate, EarnerInUse, EarnerInvalid, EarnerNotFound } from '../payroll-problems.ts'
import { maskEarnerRegistrationNumber, normalizeEarnerRegistrationNumber } from './earner-identity.ts'
import type { EarnerIdentityType } from './earner-identity.types.ts'
import { EarnerRepository } from './earner-repository.ts'
import { type CreateEarner, type Earner, type EarnerRecord, earnerResponse, type UpdateEarner } from './earner.ts'

/** 소득자 명부 유스케이스가 쓰는 저장소와 서비스입니다. */
export type EarnerDeps = EarnerRepository | PayrollLedgerRepository | PersonalDataCipher | PersonalDataAccessLog

type Response = typeof Earner.Type
type Run<A, E> = Effect.Effect<A, E | AccessDenied, CurrentActor | EarnerDeps>

const nowIso = Effect.map(Clock.currentTimeMillis, (millis) => new Date(millis).toISOString())

/** 소득자 명부입니다. 등록한 순서입니다. */
export const listEarners = (query: PageQuery): Run<PageOf<Response>, never> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'earner:read', plans: LEDGER_PLANS, requiresTerms: true })
    const records = (yield* (yield* EarnerRepository).list(actor.companyId)).toSorted((a, b) =>
      a.id.localeCompare(b.id),
    )
    const page = paginate(records, (record) => record.id, query, { includeTotal: true })
    return { ...page, items: page.items.map(earnerResponse) }
  })

/** 소득자 하나입니다. */
export const getEarner = (id: Id<'earner'>): Run<Response, EarnerNotFound> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'earner:read', plans: LEDGER_PLANS, requiresTerms: true })
    return earnerResponse(yield* findOrFail(actor, id))
  })

/** 소득자를 명부에 올립니다. 같은 회사에 같은 신원번호가 있으면 409입니다. */
export const createEarner = (payload: typeof CreateEarner.Type): Run<Response, EarnerInvalid | EarnerDuplicate> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'earner:create', plans: LEDGER_PLANS, requiresTerms: true })
    const name = yield* nameOf(payload.name)
    const identity = yield* identityOf(actor, undefined, payload.identityType, payload.registrationNumber)
    const now = yield* nowIso
    const record: EarnerRecord = {
      id: newId('earner'),
      companyId: actor.companyId,
      name,
      ...identity,
      email: payload.email ?? null,
      departmentName: payload.departmentName ?? null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    }
    yield* (yield* EarnerRepository).save(record)
    return earnerResponse(record)
  })

/** 소득자를 고칩니다. 신원번호 종류를 바꾸면 신원번호도 함께 받아 다시 검사합니다. */
export const updateEarner = (
  id: Id<'earner'>,
  patch: typeof UpdateEarner.Type,
  expected: number | undefined,
): Run<Response, EarnerNotFound | EarnerInvalid | EarnerDuplicate | VersionMismatch> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'earner:update', plans: LEDGER_PLANS, requiresTerms: true })
    const record = yield* findOrFail(actor, id)
    yield* checkVersion(record.version, expected)
    const name = patch.name === undefined ? record.name : yield* nameOf(patch.name)
    if (patch.identityType !== undefined && patch.registrationNumber === undefined) {
      return yield* new EarnerInvalid({ violations: [{ field: 'registrationNumber', code: 'REQUIRED' }] })
    }
    const identity =
      patch.registrationNumber === undefined
        ? {}
        : yield* identityOf(actor, id, patch.identityType ?? record.identityType, patch.registrationNumber)
    const next: EarnerRecord = {
      ...record,
      ...identity,
      name,
      email: patch.email === undefined ? record.email : patch.email,
      departmentName: patch.departmentName === undefined ? record.departmentName : patch.departmentName,
      version: record.version + 1,
      updatedAt: yield* nowIso,
    }
    yield* (yield* EarnerRepository).save(next)
    return earnerResponse(next)
  })

/**
 * 소득자를 명부에서 지웁니다. 급여대장 행이 가리키는 소득자는 409입니다. 행의 사본에는 가린 값만 있어,
 * 지급명세서에 쓸 신원번호 원문이 명부에만 있기 때문입니다.
 */
export const deleteEarner = (id: Id<'earner'>): Run<void, EarnerNotFound | EarnerInUse> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'earner:delete', plans: LEDGER_PLANS, requiresTerms: true })
    yield* findOrFail(actor, id)
    const ledgers = yield* (yield* PayrollLedgerRepository).list(actor.companyId)
    if (ledgers.some((ledger) => ledger.rows.some((row) => row.earnerId === id))) return yield* new EarnerInUse({})
    yield* (yield* EarnerRepository).remove(actor.companyId, id)
  })

/** 신원번호 원문을 열람합니다. 사유와 함께 열람 기록(`PersonalDataAccessLog`)을 남깁니다. */
export const revealEarnerRegistrationNumber = (
  id: Id<'earner'>,
  reason: string,
): Run<{ identityType: EarnerIdentityType; registrationNumber: string }, EarnerNotFound> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'earner:reveal-rrn', plans: LEDGER_PLANS, requiresTerms: true })
    const record = yield* findOrFail(actor, id)
    const registrationNumber = yield* (yield* PersonalDataCipher).decrypt(
      'earnerRegistrationNumber',
      record.registrationNumberEncrypted,
    )
    yield* (yield* PersonalDataAccessLog).record({
      companyId: actor.companyId,
      userId: actor.userId,
      target: `earner:${id}:registrationNumber`,
      reason,
      at: yield* nowIso,
    })
    return { identityType: record.identityType, registrationNumber }
  })

/** 앞뒤 공백을 뺀 이름입니다. 빈 이름은 422 `EARNER_INVALID`(`name`·`REQUIRED`)입니다. */
function nameOf(value: string): Effect.Effect<string, EarnerInvalid> {
  const name = value.trim()
  return name === ''
    ? Effect.fail(new EarnerInvalid({ violations: [{ field: 'name', code: 'REQUIRED' }] }))
    : Effect.succeed(name)
}

function findOrFail(actor: Actor, id: Id<'earner'>): Effect.Effect<EarnerRecord, EarnerNotFound, EarnerRepository> {
  return Effect.gen(function* () {
    const found = yield* (yield* EarnerRepository).find(actor.companyId, id)
    if (Option.isNone(found)) return yield* new EarnerNotFound({})
    return found.value
  })
}

/** 신원번호를 검사하고 저장할 암호문·해시·가린 값을 만듭니다. `selfId`가 아닌 같은 번호의 소득자가 있으면 409입니다. */
function identityOf(
  actor: Actor,
  selfId: Id<'earner'> | undefined,
  identityType: EarnerIdentityType,
  registrationNumber: string,
): Effect.Effect<
  Pick<
    EarnerRecord,
    'identityType' | 'registrationNumberEncrypted' | 'registrationNumberHash' | 'registrationNumberMasked'
  >,
  EarnerInvalid | EarnerDuplicate,
  EarnerRepository | PersonalDataCipher
> {
  return Effect.gen(function* () {
    const normalized = normalizeEarnerRegistrationNumber(registrationNumber, identityType)
    if (normalized === null) {
      return yield* new EarnerInvalid({ violations: [{ field: 'registrationNumber', code: 'INVALID_FORMAT' }] })
    }
    const cipher = yield* PersonalDataCipher
    // 종류를 붙여 해시합니다. 여권번호와 등록번호가 같은 문자열이어도 같은 사람으로 보지 않습니다.
    const hash = yield* cipher.hash(`${identityType}:${normalized}`)
    const others = yield* (yield* EarnerRepository).list(actor.companyId)
    const duplicate = others.find((other) => other.id !== selfId && other.registrationNumberHash === hash)
    if (duplicate !== undefined) return yield* new EarnerDuplicate({ duplicateEarnerId: duplicate.id })
    return {
      identityType,
      registrationNumberEncrypted: yield* cipher.encrypt('earnerRegistrationNumber', normalized),
      registrationNumberHash: hash,
      registrationNumberMasked: maskEarnerRegistrationNumber(normalized, identityType),
    }
  })
}
