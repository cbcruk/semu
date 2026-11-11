import { Clock, Effect } from 'effect'
import { checkVersion } from '../../../shared/http/versioning.ts'
import type { VersionMismatch } from '../../../shared/problem/problem.ts'
import type { CurrentActor } from '../../identity-access/actor.ts'
import type { AccessDenied } from '../../identity-access/authorization.ts'
import { authorize } from '../../identity-access/authorization.ts'
import { applyTaxSettingPatch, TaxSettingInvalid, type TaxSettingPatch } from './tax-setting.ts'
import { validateTaxSetting } from './tax-setting-rules.ts'
import type { TaxSettingRecord } from './tax-setting.types.ts'
import { TaxSettingRepository } from './tax-setting-repository.ts'

/** 회사 세무 설정을 읽습니다. 신고 건과 같이 세무 기장(`TAXATION`)과 약관 동의가 필요합니다. */
export const getTaxSetting = (): Effect.Effect<TaxSettingRecord, AccessDenied, CurrentActor | TaxSettingRepository> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'tax-setting:read', plans: ['TAXATION'], requiresTerms: true })
    const repository = yield* TaxSettingRepository
    return yield* repository.get(actor.companyId)
  })

/**
 * 회사 세무 설정을 고칩니다. 고친 결과 전체를 회사의 사업자 형태로 검증합니다.
 *
 * 이미 만든 신고 건은 고치지 않습니다. 다음 일정 배치(`FilingScheduler.run`)가 새 설정으로 의무를 계산합니다.
 */
export const updateTaxSetting = (
  patch: typeof TaxSettingPatch.Type,
  expected: number | undefined,
): Effect.Effect<
  TaxSettingRecord,
  AccessDenied | VersionMismatch | TaxSettingInvalid,
  CurrentActor | TaxSettingRepository
> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'tax-setting:update', plans: ['TAXATION'], requiresTerms: true })
    const repository = yield* TaxSettingRepository
    const current = yield* repository.get(actor.companyId)
    yield* checkVersion(current.version, expected)
    const next = applyTaxSettingPatch(current, patch, new Date(yield* Clock.currentTimeMillis).toISOString())
    const violation = validateTaxSetting(next, actor.businessType)
    if (violation !== undefined) return yield* new TaxSettingInvalid(violation)
    yield* repository.save(actor.companyId, next)
    return next
  })
