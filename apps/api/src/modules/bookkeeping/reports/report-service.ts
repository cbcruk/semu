import { Context, Effect, Layer } from 'effect'
import { addDays } from '../../../shared/time/calendar.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { companyDateOf } from '../../../shared/time/date-format.ts'
import type { BusinessType } from '../../identity-access/actor.types.ts'
import { loadAccountTitleIndex } from '../account-titles/account-title-index.ts'
import { CASH_ACCOUNT_TYPES } from '../bank/balance-snapshot.ts'
import {
  AccountTitleRepository,
  BalanceSnapshotRepository,
  BankAccountRepository,
  BankTransactionRepository,
  EvidenceRepository,
  GiroRepository,
} from '../common/repositories.ts'
import { evidenceAmounts } from '../evidence/evidence-amounts.ts'
import { LaborCostSource } from '../ports/labor-cost-source.ts'
import type { LaborCostMonth } from '../ports/labor-cost-source.ts'
import { VatEstimateSource } from '../ports/vat-estimate-source.ts'
import { cashFlowFigures, groupByAccountTitle } from './cash-status.ts'
import type { CashFlowFigures, CashTransaction } from './cash-status.ts'
import type { PlPolicy, RealtimeProfitLoss } from './realtime-pl.ts'
import { realtimeProfitLoss } from './realtime-pl.ts'
import { daysUntilDue } from './vat-due-date.ts'

/**
 * 실시간 손익 정책입니다. 현행 회사 설정의 기본값(공급가액 기준, 분류된 입출금 포함)입니다.
 *
 * 회사별 설정 화면은 아직 옮기지 않았습니다 (`docs/design/bookkeeping.md` 열린 질문).
 */
export const DEFAULT_PL_POLICY: PlPolicy = { basis: 'SUPPLY', includeBank: true }

/** 하루 자금 현황입니다. */
export interface CashStatusView {
  date: string
  figures: CashFlowFigures
  byAccountTitle: ReturnType<typeof groupByAccountTitle>
}

/** 홈 경영 현황입니다. */
export interface HomeSummaryView {
  date: string
  profitLoss: { month: string; revenueAmount: number; expenseAmount: number; netIncomeAmount: number }
  cash: { date: string; depositAmount: number; withdrawalAmount: number; closingAmount: number }
  vat: { periodStart: string; periodEnd: string; estimatedTaxAmount: number; dueDate: string; daysUntilDue: number }
  giros: { todoCount: number; todoAmount: number }
}

/** 실시간 보고서입니다. 저장하지 않고 요청마다 증빙·입출금·잔액에서 계산합니다. */
export class ReportService extends Context.Service<
  ReportService,
  {
    realtimeProfitLoss(
      companyId: Id<'company'>,
      year: number,
      cumulative: boolean,
    ): Effect.Effect<RealtimeProfitLoss & PlPolicy & { year: number; cumulative: boolean }>
    cashStatus(companyId: Id<'company'>, date: string): Effect.Effect<CashStatusView>
    homeSummary(companyId: Id<'company'>, businessType: BusinessType, today: string): Effect.Effect<HomeSummaryView>
    laborCost(companyId: Id<'company'>, year: number): Effect.Effect<ReadonlyArray<LaborCostMonth>>
  }
>()('semu/bookkeeping/ReportService') {
  static readonly layer = Layer.effect(
    ReportService,
    Effect.gen(function* () {
      const titles = yield* AccountTitleRepository
      const evidence = yield* EvidenceRepository
      const transactions = yield* BankTransactionRepository
      const accounts = yield* BankAccountRepository
      const snapshots = yield* BalanceSnapshotRepository
      const giros = yield* GiroRepository
      const vat = yield* VatEstimateSource
      const laborCost = yield* LaborCostSource

      const profitLoss = Effect.fn('ReportService.realtimeProfitLoss')(function* (
        companyId: Id<'company'>,
        year: number,
        cumulative: boolean,
      ) {
        const index = yield* Effect.provideService(loadAccountTitleIndex(companyId), AccountTitleRepository, titles)
        const result = realtimeProfitLoss({
          year,
          cumulative,
          policy: DEFAULT_PL_POLICY,
          titles: index,
          evidence: (yield* evidence.list(companyId)).map((row) => {
            const amounts = evidenceAmounts(row)
            return {
              side: row.side,
              date: row.writtenOn,
              accountTitleId: row.classification.accountTitleId,
              supplyAmount: amounts.supplyAmount,
              totalAmount: amounts.totalAmount,
            }
          }),
          bank: (yield* transactions.list(companyId)).map((row) => ({
            date: companyDateOf(row.transactedAt) ?? '',
            accountTitleId: row.classification.accountTitleId,
            amount: row.amount,
          })),
        })
        return { ...result, ...DEFAULT_PL_POLICY, year, cumulative }
      })

      const cashStatus = Effect.fn('ReportService.cashStatus')(function* (companyId: Id<'company'>, date: string) {
        const cashAccounts = (yield* accounts.list(companyId)).filter(
          (row) =>
            CASH_ACCOUNT_TYPES.includes(row.accountTypeCode) &&
            row.cashReport === 'INCLUDED' &&
            row.status !== 'INACTIVE',
        )
        const ids = new Set<string>(cashAccounts.map((row) => row.id))
        const allSnapshots = (yield* snapshots.list(companyId)).filter((row) => ids.has(row.bankAccountId))
        const dayTransactions: CashTransaction[] = (yield* transactions.list(companyId))
          .filter((row) => ids.has(row.bankAccountId) && companyDateOf(row.transactedAt) === date)
          .map((row) => ({
            bankAccountId: row.bankAccountId,
            date,
            direction: row.direction,
            amount: row.amount,
            accountTitleId: row.classification.accountTitleId,
          }))
        const index = yield* Effect.provideService(loadAccountTitleIndex(companyId), AccountTitleRepository, titles)
        return {
          date,
          figures: cashFlowFigures({
            snapshotsByAccount: cashAccounts.map((account) =>
              allSnapshots.filter((row) => row.bankAccountId === account.id),
            ),
            transactions: dayTransactions,
            start: date,
            end: date,
          }),
          byAccountTitle: groupByAccountTitle(dayTransactions, index),
        }
      })

      return ReportService.of({
        realtimeProfitLoss: profitLoss,
        cashStatus,
        homeSummary: Effect.fn('ReportService.homeSummary')(function* (companyId, businessType, today) {
          const month = today.slice(0, 7)
          const pl = yield* profitLoss(companyId, Number(today.slice(0, 4)), false)
          const monthFigures = pl.months.find((row) => row.month === month)
          const cash = yield* cashStatus(companyId, addDays(today, -1))
          const estimate = yield* vat.current(companyId, businessType, today)
          const todo = (yield* giros.list(companyId)).filter((row) => row.status === 'TODO')
          return {
            date: today,
            profitLoss: {
              month,
              revenueAmount: monthFigures?.revenueAmount ?? 0,
              expenseAmount:
                (monthFigures?.costOfSalesAmount ?? 0) +
                (monthFigures?.sgaAmount ?? 0) +
                (monthFigures?.nonOperatingExpenseAmount ?? 0),
              netIncomeAmount: monthFigures?.netIncomeAmount ?? 0,
            },
            cash: {
              date: cash.date,
              depositAmount: cash.figures.depositAmount,
              withdrawalAmount: cash.figures.withdrawalAmount,
              closingAmount: cash.figures.closingAmount,
            },
            vat: {
              periodStart: estimate.period.start,
              periodEnd: estimate.period.end,
              estimatedTaxAmount: estimate.estimatedTaxAmount,
              dueDate: estimate.dueDate,
              daysUntilDue: daysUntilDue(today, estimate.dueDate),
            },
            giros: { todoCount: todo.length, todoAmount: todo.reduce((sum, row) => sum + row.payAmount, 0) },
          }
        }),
        laborCost: (companyId, year) => laborCost.monthly(companyId, year),
      })
    }),
  )
}
