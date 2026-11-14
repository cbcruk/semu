import { Clock, Effect } from 'effect'
import { UnitOfWork } from '../../../shared/persistence/unit-of-work.ts'
import type { ScheduledTask } from '../../../shared/scheduler/scheduler.ts'
import { companyDate } from '../../../shared/time/company-date.ts'
import { Payments } from './payments.ts'

/**
 * 매일 06:00(회사 시간대)에 돌아 결제 예정을 오늘의 구독·출금 동의에 다시 맞춥니다(`Payments.reconcile`).
 *
 * - 출금일 3일 전부터 전날까지는 그달 결제 예정을 만듭니다. 같은 구독·출금일의 결제가 있으면 만들지 않으므로 사흘 동안 돌아도 한
 *   건이고, 첫날 실패해도 다음 날 만듭니다. 그 밖의 날은 만들지 않습니다(`month: null`)
 * - 출금일이 오지 않은 `SCHEDULED` 결제는 자격이 없어졌으면 취소하고 금액·출금 계좌를 고칩니다. 구독·출금 동의를 바꾸는 커맨드도
 *   그 회사를 바로 다시 맞추므로, 이 작업은 커맨드를 거치지 않은 변경(종료일이 지난 구독 등)을 거두는 안전망입니다
 *
 * 구독 전체를 한 번에 보는 작업이라 회사별로 나누지 않고 한 트랜잭션입니다. 결과는 대상 달과 만든·취소한·고친 건수입니다.
 */
export const paymentScheduleTask: ScheduledTask<Payments | UnitOfWork> = {
  name: 'billing.payment-schedule',
  spec: { kind: 'DAILY', at: '06:00' },
  run: () =>
    Effect.gen(function* () {
      const today = companyDate(yield* Clock.currentTimeMillis)
      const payments = yield* Payments
      const result = yield* (yield* UnitOfWork).run(payments.reconcile(today))
      return {
        month: result.month,
        created: result.created.length,
        canceled: result.canceled.length,
        updated: result.updated.length,
      }
    }),
}
