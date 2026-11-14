import { Clock, Effect } from 'effect'
import { UnitOfWork } from '../../../shared/persistence/unit-of-work.ts'
import type { ScheduledTask } from '../../../shared/scheduler/scheduler.ts'
import { companyDate } from '../../../shared/time/company-date.ts'
import { upcomingBillingMonth } from './payment-schedule.ts'
import { Payments } from './payments.ts'
import { PublicHolidays } from './public-holidays.ts'

/**
 * 매일 06:00(회사 시간대)에 다가오는 출금일의 결제 예정을 맞춥니다(`Payments.scheduleMonth`). 같은 구독·출금일의 결제가 있으면 만들지
 * 않으므로 매일 돌아도 한 건이고, 달 중간에 시작한 구독도 출금일 전날까지는 그달 결제 예정이 생깁니다.
 *
 * 구독 전체를 한 번에 보는 작업이라 회사별로 나누지 않고 한 트랜잭션입니다. 결과는 대상 달과 새로 만든 건수입니다.
 */
export const paymentScheduleTask: ScheduledTask<Payments | PublicHolidays | UnitOfWork> = {
  name: 'billing.payment-schedule',
  spec: { kind: 'DAILY', at: '06:00' },
  run: () =>
    Effect.gen(function* () {
      const today = companyDate(yield* Clock.currentTimeMillis)
      const month = upcomingBillingMonth(today, yield* (yield* PublicHolidays).all())
      const payments = yield* Payments
      const created = yield* (yield* UnitOfWork).run(payments.scheduleMonth(month))
      return { month, created: created.length }
    }),
}
