import { Effect, Option } from 'effect'
import { checkVersion } from '../../../shared/http/versioning.ts'
import type { VersionMismatch } from '../../../shared/problem/problem.ts'
import type { CurrentActor } from '../../identity-access/actor.ts'
import type { AccessDenied } from '../../identity-access/authorization.ts'
import { authorize } from '../../identity-access/authorization.ts'
import { TaxSettingRepository } from '../settings/tax-setting-repository.ts'
import { currentInstant } from '../tax-time.ts'
import { cumulativeProfitLoss, deriveBalanceSheetMonth, validateBalanceSheetUpload } from './balance-sheet-rules.ts'
import { deriveCashFlowMonth, validateCashFlowUpload } from './cash-flow-rules.ts'
import { SettlementReportNotFound, SettlementSnapshotInvalid } from './settlement-report.ts'
import type {
  BalanceSheetReport,
  BalanceSheetUploadBody,
  CashFlowReport,
  CashFlowUploadBody,
  ProfitLossReport,
  ProfitLossUploadBody,
  SettlementReportList,
} from './settlement-report.ts'
import type {
  BalanceSheetSnapshotRecord,
  CashFlowSnapshotRecord,
  FiscalPeriod,
  ProfitLossSnapshotRecord,
  SettlementSnapshotMeta,
  SettlementSnapshotViolation,
} from './settlement-report.types.ts'
import { deriveProfitLossMonth, fiscalPeriod, sumProfitLoss, validateProfitLossUpload } from './settlement-rules.ts'
import { SettlementSnapshotRepository } from './settlement-snapshot-repository.ts'
import type { SnapshotStore } from './settlement-snapshot-repository.ts'

const READ = { permission: 'settlement-report:read', plans: ['TAXATION'], requiresTerms: true } as const
const UPLOAD = { permission: 'settlement-report:upload', plans: ['TAXATION'], requiresTerms: true } as const

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

/** 저장한 스냅샷을 자금 흐름 응답으로 바꿉니다. 계정 합계와 결산 기준일의 보유자금을 채웁니다. */
function toCashFlowReport(snapshot: CashFlowSnapshotRecord): typeof CashFlowReport.Type {
  const months = snapshot.months.map(deriveCashFlowMonth).toSorted((a, b) => a.month.localeCompare(b.month))
  return {
    fiscalYear: snapshot.fiscalYear,
    period: snapshot.period,
    closedThrough: snapshot.closedThrough,
    openingBalances: snapshot.openingBalances,
    months,
    fundsHeld: months.at(-1)?.fundsHeld ?? 0,
    version: snapshot.version,
    updatedAt: snapshot.updatedAt,
  }
}

/** 결산 데이터가 있는 보고서·사업연도 목록입니다. 사업연도 내림차순이고, 같은 사업연도는 손익계산서·자금 흐름·재무상태표 순입니다. */
export const listSettlementReports = (): Effect.Effect<
  typeof SettlementReportList.Type,
  AccessDenied,
  CurrentActor | SettlementSnapshotRepository
> =>
  Effect.gen(function* () {
    const actor = yield* authorize(READ)
    const repository = yield* SettlementSnapshotRepository
    const available =
      (report: 'PROFIT_LOSS' | 'CASH_FLOW' | 'BALANCE_SHEET', order: number) => (snapshot: SettlementSnapshotMeta) => ({
        order,
        item: {
          report,
          fiscalYear: snapshot.fiscalYear,
          closedThrough: snapshot.closedThrough,
          updatedAt: snapshot.updatedAt,
        },
      })
    const items = [
      ...(yield* repository.profitLoss.list(actor.companyId)).map(available('PROFIT_LOSS', 0)),
      ...(yield* repository.cashFlow.list(actor.companyId)).map(available('CASH_FLOW', 1)),
      ...(yield* repository.balanceSheet.list(actor.companyId)).map(available('BALANCE_SHEET', 2)),
    ]
      .toSorted((a, b) => b.item.fiscalYear - a.item.fiscalYear || a.order - b.order)
      .map(({ item }) => item)
    return { items }
  })

/** 사업연도의 스냅샷을 읽습니다. 아직 올리지 않았으면 404입니다. */
const readSnapshot = <T extends SettlementSnapshotMeta>(
  pick: (repository: typeof SettlementSnapshotRepository.Service) => SnapshotStore<T>,
  fiscalYear: number,
): Effect.Effect<T, AccessDenied | SettlementReportNotFound, CurrentActor | SettlementSnapshotRepository> =>
  Effect.gen(function* () {
    const actor = yield* authorize(READ)
    const found = yield* pick(yield* SettlementSnapshotRepository).find(actor.companyId, fiscalYear)
    if (Option.isNone(found)) return yield* new SettlementReportNotFound()
    return found.value
  })

/**
 * 담당자가 사업연도의 스냅샷을 올립니다. 그 사업연도의 스냅샷을 통째로 바꾸고 버전을 올립니다. 대리인 전용입니다.
 *
 * 사업연도 기간은 지금 세무 설정의 결산월로 정합니다. 결산월을 바꾸면 이미 올린 스냅샷의 기간은 그대로이고, 다시 올릴 때 새 기간으로 봅니다.
 */
const uploadSnapshot = <T extends SettlementSnapshotMeta, B extends { closedThrough: string }>(
  pick: (repository: typeof SettlementSnapshotRepository.Service) => SnapshotStore<T>,
  fiscalYear: number,
  body: B,
  expected: number | undefined,
  validate: (body: B, period: FiscalPeriod, today: string) => SettlementSnapshotViolation | undefined,
  build: (body: B, meta: SettlementSnapshotMeta) => T,
): Effect.Effect<
  T,
  AccessDenied | VersionMismatch | SettlementSnapshotInvalid,
  CurrentActor | SettlementSnapshotRepository | TaxSettingRepository
> =>
  Effect.gen(function* () {
    const actor = yield* authorize(UPLOAD)
    const store = pick(yield* SettlementSnapshotRepository)
    const current = yield* store.find(actor.companyId, fiscalYear)
    const currentVersion = Option.match(current, { onNone: () => 0, onSome: (snapshot) => snapshot.version })
    yield* checkVersion(currentVersion, expected)

    const setting = yield* (yield* TaxSettingRepository).get(actor.companyId)
    const period = fiscalPeriod(fiscalYear, setting.fiscalYearEndMonth)
    const { now, today } = yield* currentInstant
    const violation = validate(body, period, today)
    if (violation !== undefined) return yield* new SettlementSnapshotInvalid(violation)

    const snapshot = build(body, {
      companyId: actor.companyId,
      fiscalYear,
      period,
      closedThrough: body.closedThrough,
      version: currentVersion + 1,
      updatedAt: now,
      updatedBy: actor.userId,
    })
    yield* store.save(snapshot)
    return snapshot
  })

/** 사업연도의 결산 손익계산서입니다. 아직 올리지 않았으면 404입니다. */
export const getProfitLossReport = (
  fiscalYear: number,
): Effect.Effect<
  typeof ProfitLossReport.Type,
  AccessDenied | SettlementReportNotFound,
  CurrentActor | SettlementSnapshotRepository
> =>
  Effect.map(
    readSnapshot((repository) => repository.profitLoss, fiscalYear),
    toProfitLossReport,
  )

/** 담당자가 사업연도의 손익 스냅샷을 올립니다. 대리인 전용입니다. */
export const uploadProfitLoss = (
  fiscalYear: number,
  body: typeof ProfitLossUploadBody.Type,
  expected: number | undefined,
): Effect.Effect<
  typeof ProfitLossReport.Type,
  AccessDenied | VersionMismatch | SettlementSnapshotInvalid,
  CurrentActor | SettlementSnapshotRepository | TaxSettingRepository
> =>
  Effect.map(
    uploadSnapshot(
      (repository) => repository.profitLoss,
      fiscalYear,
      body,
      expected,
      validateProfitLossUpload,
      (upload, meta): ProfitLossSnapshotRecord => ({ ...meta, months: upload.months }),
    ),
    toProfitLossReport,
  )

/** 사업연도의 결산 자금 흐름입니다. 아직 올리지 않았으면 404입니다. */
export const getCashFlowReport = (
  fiscalYear: number,
): Effect.Effect<
  typeof CashFlowReport.Type,
  AccessDenied | SettlementReportNotFound,
  CurrentActor | SettlementSnapshotRepository
> =>
  Effect.map(
    readSnapshot((repository) => repository.cashFlow, fiscalYear),
    toCashFlowReport,
  )

/** 담당자가 사업연도의 자금 흐름 스냅샷을 올립니다. 대리인 전용입니다. */
export const uploadCashFlow = (
  fiscalYear: number,
  body: typeof CashFlowUploadBody.Type,
  expected: number | undefined,
): Effect.Effect<
  typeof CashFlowReport.Type,
  AccessDenied | VersionMismatch | SettlementSnapshotInvalid,
  CurrentActor | SettlementSnapshotRepository | TaxSettingRepository
> =>
  Effect.map(
    uploadSnapshot(
      (repository) => repository.cashFlow,
      fiscalYear,
      body,
      expected,
      validateCashFlowUpload,
      (upload, meta): CashFlowSnapshotRecord => ({
        ...meta,
        openingBalances: upload.openingBalances,
        months: upload.months,
      }),
    ),
    toCashFlowReport,
  )

/**
 * 저장한 스냅샷을 재무상태표 응답으로 바꿉니다. 총계와 재무 비율을 채웁니다. 손익을 쓰는 비율은 같은 회사·사업연도의
 * 손익계산서 스냅샷에서 누계를 읽고, 없으면 `null`입니다.
 */
const toBalanceSheetReport = (
  snapshot: BalanceSheetSnapshotRecord,
): Effect.Effect<typeof BalanceSheetReport.Type, never, SettlementSnapshotRepository> =>
  Effect.gen(function* () {
    const profitLoss = yield* (yield* SettlementSnapshotRepository).profitLoss.find(
      snapshot.companyId,
      snapshot.fiscalYear,
    )
    const cumulative = Option.match(profitLoss, {
      onNone: () => new Map(),
      onSome: (found) => cumulativeProfitLoss(found.months.map(deriveProfitLossMonth)),
    })
    return {
      fiscalYear: snapshot.fiscalYear,
      period: snapshot.period,
      closedThrough: snapshot.closedThrough,
      months: snapshot.months
        .map((month) => deriveBalanceSheetMonth(month, cumulative.get(month.month)))
        .toSorted((a, b) => a.month.localeCompare(b.month)),
      version: snapshot.version,
      updatedAt: snapshot.updatedAt,
    }
  })

/** 사업연도의 결산 재무상태표입니다. 아직 올리지 않았으면 404입니다. */
export const getBalanceSheetReport = (
  fiscalYear: number,
): Effect.Effect<
  typeof BalanceSheetReport.Type,
  AccessDenied | SettlementReportNotFound,
  CurrentActor | SettlementSnapshotRepository
> =>
  Effect.flatMap(
    readSnapshot((repository) => repository.balanceSheet, fiscalYear),
    toBalanceSheetReport,
  )

/** 담당자가 사업연도의 재무상태표 스냅샷을 올립니다. 대리인 전용입니다. */
export const uploadBalanceSheet = (
  fiscalYear: number,
  body: typeof BalanceSheetUploadBody.Type,
  expected: number | undefined,
): Effect.Effect<
  typeof BalanceSheetReport.Type,
  AccessDenied | VersionMismatch | SettlementSnapshotInvalid,
  CurrentActor | SettlementSnapshotRepository | TaxSettingRepository
> =>
  Effect.flatMap(
    uploadSnapshot(
      (repository) => repository.balanceSheet,
      fiscalYear,
      body,
      expected,
      validateBalanceSheetUpload,
      (upload, meta): BalanceSheetSnapshotRecord => ({ ...meta, months: upload.months }),
    ),
    toBalanceSheetReport,
  )
