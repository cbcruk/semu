import { Context, Effect, Layer } from 'effect'
import { newId } from '../../../shared/ids/ids.ts'
import { addDays } from '../../../shared/time/calendar.ts'
import { ActionCards } from '../action-cards/action-cards.ts'
import type { FilingRecord } from '../filings/filing.types.ts'
import { FilingRepository } from '../filings/filing-repository.ts'
import { filingStatusChanged } from '../filings/filing-view.ts'
import { payrollLedgerResponse, requirementTemplate } from '../filings/filing-requirements.ts'
import { PayrollLedgers, relinkAutoRequirements } from '../filings/payroll-ledgers.ts'
import { TaxEvents } from '../tax.public.ts'
import { currentInstant } from '../tax-time.ts'
import type { FilingObligation } from './filing-calendar.types.ts'
import { resolveFilingObligations } from './filing-obligations.ts'
import { planSchedule } from './filing-schedule.ts'
import type { ScheduledFilingFact } from './filing-schedule.ts'
import { PublicHolidays } from './public-holidays.ts'
import { TaxProfiles } from './tax-profiles.ts'
import type { TaxProfile } from './tax-profiles.ts'

/** 일정 배치가 미리 만드는 기간입니다. 납부 기한이 오늘부터 이 날수 안인 신고 건을 둡니다. 현행 배치와 같습니다. */
export const SCHEDULE_HORIZON_DAYS = 120

/** 일정 배치 한 번의 결과입니다. */
export interface ScheduleRunResult {
  created: number
  refreshed: number
  restored: number
  canceled: number
}

/**
 * 세무 기장 회사의 신고 건을 계산한 의무에 맞춰 만들고, 기한을 고치고, 해당 없는 예정 건을 취소합니다.
 *
 * 엔드포인트 없이 매일 배치와 공휴일표 변경 뒤에 부릅니다. 세무 설정 변경은 바로 부르지 않고 다음 실행이 새 설정을 씁니다.
 * 같은 날 다시 돌려도 결과가 같습니다.
 */
export class FilingScheduler extends Context.Service<
  FilingScheduler,
  {
    run(): Effect.Effect<ScheduleRunResult>
    runFor(profile: TaxProfile): Effect.Effect<ScheduleRunResult>
  }
>()('semu/tax/FilingScheduler') {
  static readonly layer = Layer.effect(
    FilingScheduler,
    Effect.gen(function* () {
      const profiles = yield* TaxProfiles
      const holidays = yield* PublicHolidays
      const repository = yield* FilingRepository
      const payrollLedgers = yield* PayrollLedgers
      const cards = yield* ActionCards
      const events = yield* TaxEvents

      const runFor = Effect.fn('FilingScheduler.runFor')(function* (profile: TaxProfile) {
        const { now, today } = yield* currentInstant
        const window = { from: today, to: addDays(today, SCHEDULE_HORIZON_DAYS) }
        const holidaySet = yield* holidays.between(addDays(window.from, -31), addDays(window.to, 31))
        const obligations = resolveFilingObligations({ profile, ...window, holidays: holidaySet })
        const existing = yield* repository.list(profile.companyId)
        const plan = planSchedule(obligations, existing.map(scheduledFactOf), window)
        const byId = new Map(existing.map((filing) => [filing.id as string, filing]))

        for (const obligation of plan.create) {
          yield* repository.save(yield* newScheduledFiling(profile, obligation, now))
        }
        for (const { filingId, obligation } of plan.refresh) {
          const filing = byId.get(filingId)!
          yield* repository.save({
            ...filing,
            statutoryDue: obligation.statutoryDue,
            dueDate: obligation.dueDate,
            paymentDue: obligation.paymentDue,
            history: [
              ...filing.history,
              systemEntry(
                'DEADLINES_REFRESHED',
                null,
                null,
                { dueDate: obligation.dueDate ?? '', paymentDue: obligation.paymentDue },
                now,
              ),
            ],
            version: filing.version + 1,
            updatedAt: now,
          })
        }
        for (const { filingId, obligation } of plan.restore) {
          const filing = byId.get(filingId)!
          // 취소된 동안 급여대장 이벤트가 이 건을 건너뛰었으므로 자동 연계 항목만 지금 현황으로 다시 맞춥니다
          const relinked = yield* relinkAutoRequirements(
            payrollLedgers,
            {
              ...filing,
              status: 'SCHEDULED',
              statutoryDue: obligation.statutoryDue,
              dueDate: obligation.dueDate,
              paymentDue: obligation.paymentDue,
              history: [...filing.history, systemEntry('SCHEDULE_RESTORED', 'CANCELED', 'SCHEDULED', {}, now)],
            },
            now,
          )
          const restored: FilingRecord = { ...relinked.filing, version: filing.version + 1, updatedAt: now }
          yield* repository.save(restored)
          yield* events.publish([filingStatusChanged(filing, restored, now)])
        }
        for (const filingId of plan.cancel) {
          const filing = byId.get(filingId)!
          const canceled: FilingRecord = {
            ...filing,
            status: 'CANCELED',
            history: [...filing.history, systemEntry('SCHEDULE_CANCELED', filing.status, 'CANCELED', {}, now)],
            version: filing.version + 1,
            updatedAt: now,
          }
          yield* repository.save(canceled)
          yield* cards.applyFilingTrigger(canceled, 'SCHEDULE_CANCELED', now)
          yield* events.publish([filingStatusChanged(filing, canceled, now)])
        }
        return {
          created: plan.create.length,
          refreshed: plan.refresh.length,
          restored: plan.restore.length,
          canceled: plan.cancel.length,
        }
      })

      const newScheduledFiling = Effect.fn('FilingScheduler.newScheduledFiling')(function* (
        profile: TaxProfile,
        obligation: FilingObligation,
        now: string,
      ) {
        const templates = requirementTemplate(obligation.taxType, obligation.kind, profile.plans.includes('PAYROLL'))
        const linked = templates.some((template) => template.autoLinked)
          ? payrollLedgerResponse(
              yield* payrollLedgers.summaryFor(profile.companyId, obligation.periodStart, obligation.periodEnd),
            )
          : 'PENDING'
        const filing: FilingRecord = {
          id: newId('filing'),
          companyId: profile.companyId,
          taxType: obligation.taxType,
          kind: obligation.kind,
          periodKey: obligation.periodKey,
          revision: 0,
          periodStart: obligation.periodStart,
          periodEnd: obligation.periodEnd,
          statutoryDue: obligation.statutoryDue,
          dueDate: obligation.dueDate,
          paymentDue: obligation.paymentDue,
          submitDue: null,
          status: 'SCHEDULED',
          payableAmount: null,
          settlement: null,
          paidOn: null,
          ledgerUploadedAt: null,
          ledgerConfirmedAt: null,
          ledgerDisputeCount: 0,
          paymentSlipSentAt: null,
          requirements: templates.map((template) => ({
            code: template.code,
            response: template.autoLinked ? linked : 'PENDING',
            autoLinked: template.autoLinked,
            note: null,
            fileIds: [],
            updatedBy: null,
            updatedAt: null,
          })),
          documents: [],
          history: [systemEntry('SCHEDULED', null, 'SCHEDULED', {}, now)],
          version: 1,
          createdAt: now,
          updatedAt: now,
        }
        return filing
      })

      const run = Effect.fn('FilingScheduler.run')(function* () {
        const companies = yield* profiles.listTaxation()
        const results = yield* Effect.forEach(companies, runFor)
        return results.reduce(
          (sum, result) => ({
            created: sum.created + result.created,
            refreshed: sum.refreshed + result.refreshed,
            restored: sum.restored + result.restored,
            canceled: sum.canceled + result.canceled,
          }),
          { created: 0, refreshed: 0, restored: 0, canceled: 0 },
        )
      })

      return FilingScheduler.of({ run, runFor })
    }),
  )
}

/** 저장된 신고 건을 일정 배치가 보는 사실로 옮깁니다. 취소 주체는 `CANCELED`로 바꾼 마지막 이력으로 가립니다. */
function scheduledFactOf(filing: FilingRecord): ScheduledFilingFact {
  const cancelType = filing.history.findLast((entry) => entry.toStatus === 'CANCELED')?.type
  return {
    id: filing.id,
    taxType: filing.taxType,
    kind: filing.kind,
    periodKey: filing.periodKey,
    status: filing.status,
    dueDate: filing.dueDate,
    paymentDue: filing.paymentDue,
    canceledBy: filing.status !== 'CANCELED' ? null : cancelType === 'SCHEDULE_CANCELED' ? 'SCHEDULE' : 'USER',
  }
}

function systemEntry(
  type: FilingRecord['history'][number]['type'],
  fromStatus: FilingRecord['status'] | null,
  toStatus: FilingRecord['status'] | null,
  detail: Record<string, string | number>,
  now: string,
): FilingRecord['history'][number] {
  return { type, actorKind: 'SYSTEM', actorId: null, fromStatus, toStatus, detail, occurredAt: now }
}
