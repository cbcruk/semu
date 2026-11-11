import { Effect, Option } from 'effect'
import { checkVersion } from '../../../shared/http/versioning.ts'
import type { VersionMismatch } from '../../../shared/problem/problem.ts'
import type { CurrentActor } from '../../identity-access/actor.ts'
import type { AccessDenied } from '../../identity-access/authorization.ts'
import { authorize } from '../../identity-access/authorization.ts'
import { TaxSettingRepository } from '../settings/tax-setting-repository.ts'
import { currentInstant } from '../tax-time.ts'
import { SettlementReportNotFound, SettlementSnapshotInvalid } from './settlement-report.ts'
import type { ProfitLossReport, ProfitLossUploadBody, SettlementReportList } from './settlement-report.ts'
import type { ProfitLossSnapshotRecord } from './settlement-report.types.ts'
import { deriveProfitLossMonth, fiscalPeriod, sumProfitLoss, validateProfitLossUpload } from './settlement-rules.ts'
import { SettlementSnapshotRepository } from './settlement-snapshot-repository.ts'

const READ = { permission: 'settlement-report:read', plans: ['TAXATION'], requiresTerms: true } as const

/** 저장한 스냅샷을 손익계산서 응답으로 바꿉니다. 계산 섹션과 당기 누계를 채웁니다. */
function toProfitLossReport(snapshot: ProfitLossSnapshotRecord): typeof ProfitLossReport.Type {
  const months = snapshot.months.map(deriveProfitLossMonth).toSorted((a, b) => a.month.localeCompare(b.month))
  return {
    fiscalYear: snapshot.fiscalYear,
    period: snapshot.period,
    closedThrough: snapshot.closedThrough,
    months,
    total: sumProfitLoss(months),
    version: snapshot.version,
    updatedAt: snapshot.updatedAt,
  }
}

/** 결산 데이터가 있는 보고서·사업연도 목록입니다. 사업연도 내림차순입니다. */
export const listSettlementReports = (): Effect.Effect<
  typeof SettlementReportList.Type,
  AccessDenied,
  CurrentActor | SettlementSnapshotRepository
> =>
  Effect.gen(function* () {
    const actor = yield* authorize(READ)
    const snapshots = yield* (yield* SettlementSnapshotRepository).listProfitLoss(actor.companyId)
    return {
      items: snapshots.map((snapshot) => ({
        report: 'PROFIT_LOSS' as const,
        fiscalYear: snapshot.fiscalYear,
        closedThrough: snapshot.closedThrough,
        updatedAt: snapshot.updatedAt,
      })),
    }
  })

/** 사업연도의 결산 손익계산서입니다. 아직 올리지 않았으면 404입니다. */
export const getProfitLossReport = (
  fiscalYear: number,
): Effect.Effect<
  typeof ProfitLossReport.Type,
  AccessDenied | SettlementReportNotFound,
  CurrentActor | SettlementSnapshotRepository
> =>
  Effect.gen(function* () {
    const actor = yield* authorize(READ)
    const found = yield* (yield* SettlementSnapshotRepository).findProfitLoss(actor.companyId, fiscalYear)
    if (Option.isNone(found)) return yield* new SettlementReportNotFound()
    return toProfitLossReport(found.value)
  })

/**
 * 담당자가 사업연도의 손익 스냅샷을 올립니다. 그 사업연도의 스냅샷을 통째로 바꾸고 버전을 올립니다. 대리인 전용입니다.
 *
 * 사업연도 기간은 지금 세무 설정의 결산월로 정합니다. 결산월을 바꾸면 이미 올린 스냅샷의 기간은 그대로이고, 다시 올릴 때 새 기간으로 봅니다.
 */
export const uploadProfitLoss = (
  fiscalYear: number,
  body: typeof ProfitLossUploadBody.Type,
  expected: number | undefined,
): Effect.Effect<
  typeof ProfitLossReport.Type,
  AccessDenied | VersionMismatch | SettlementSnapshotInvalid,
  CurrentActor | SettlementSnapshotRepository | TaxSettingRepository
> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'settlement-report:upload', plans: ['TAXATION'], requiresTerms: true })
    const repository = yield* SettlementSnapshotRepository
    const current = yield* repository.findProfitLoss(actor.companyId, fiscalYear)
    yield* checkVersion(Option.match(current, { onNone: () => 0, onSome: (snapshot) => snapshot.version }), expected)

    const setting = yield* (yield* TaxSettingRepository).get(actor.companyId)
    const period = fiscalPeriod(fiscalYear, setting.fiscalYearEndMonth)
    const { now, today } = yield* currentInstant
    const violation = validateProfitLossUpload(body, period, today)
    if (violation !== undefined) return yield* new SettlementSnapshotInvalid(violation)

    const snapshot: ProfitLossSnapshotRecord = {
      companyId: actor.companyId,
      fiscalYear,
      period,
      closedThrough: body.closedThrough,
      months: body.months,
      version: Option.match(current, { onNone: () => 1, onSome: (snapshot) => snapshot.version + 1 }),
      updatedAt: now,
      updatedBy: actor.userId,
    }
    yield* repository.saveProfitLoss(snapshot)
    return toProfitLossReport(snapshot)
  })
