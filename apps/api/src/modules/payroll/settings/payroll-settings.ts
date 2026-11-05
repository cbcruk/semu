import { Clock, Effect } from 'effect'
import { checkVersion } from '../../../shared/http/versioning.ts'
import type { VersionMismatch } from '../../../shared/problem/problem.ts'
import type { AccessDenied } from '../../identity-access/authorization.ts'
import { authorize } from '../../identity-access/authorization.ts'
import type { CurrentActor } from '../../identity-access/actor.ts'
import { applyPayrollSettingPatch, type PayrollSettingPatch } from './payroll-setting.ts'
import type { PayrollSettingRecord } from './payroll-setting.types.ts'
import { PayrollSettingRepository } from './payroll-setting-repository.ts'

/** 회사 급여 설정을 읽습니다. */
export const getPayrollSetting = (): Effect.Effect<
  PayrollSettingRecord,
  AccessDenied,
  CurrentActor | PayrollSettingRepository
> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'payroll-setting:read', plans: ['PAYROLL'], requiresTerms: true })
    const repository = yield* PayrollSettingRepository
    return yield* repository.get(actor.companyId)
  })

/**
 * 회사 급여 설정을 고칩니다. 운영 방식(`workflow`)을 바꾸려면 `payroll-workflow:update` 권한이 더 필요합니다.
 * 급여 아웃소싱 계약은 세무 대리인이 정하기 때문입니다.
 */
export const updatePayrollSetting = (
  patch: typeof PayrollSettingPatch.Type,
  expected: number | undefined,
): Effect.Effect<PayrollSettingRecord, AccessDenied | VersionMismatch, CurrentActor | PayrollSettingRepository> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'payroll-setting:update', plans: ['PAYROLL'], requiresTerms: true })
    if (patch.workflow !== undefined) yield* authorize({ permission: 'payroll-workflow:update' })
    const repository = yield* PayrollSettingRepository
    const current = yield* repository.get(actor.companyId)
    yield* checkVersion(current.version, expected)
    const next = applyPayrollSettingPatch(current, patch, new Date(yield* Clock.currentTimeMillis).toISOString())
    yield* repository.save(actor.companyId, next)
    return next
  })
