import { Clock, Effect, Option } from 'effect'
import { UnitOfWork } from '../../../shared/persistence/unit-of-work.ts'
import type { ScheduledTask } from '../../../shared/scheduler/scheduler.ts'
import { companyDate } from '../../../shared/time/company-date.ts'
import { CmsGateway } from '../mandates/cms-gateway.ts'
import type { PaymentId } from './payment.ts'
import { Payments } from './payments.ts'

/**
 * 매일 15:00(회사 시간대)에 CMS 출금 결과 파일을 끌어와 결제에 반영합니다(`Payments.recordWithdrawal`). 결과 파일은 출금 다음 날
 * 오후에 오므로, 결과 반영일이 오늘이거나 지났는데 아직 `SCHEDULED`·`RETRYING`인 결제의 출금일마다 파일을 읽습니다.
 *
 * - 파일이 아직 없거나 파일에 없는 결제는 그대로 두고 다음 날 다시 읽습니다(`pending`)
 * - 결과 파일은 트랜잭션 밖에서 읽고, 출금일 하나의 결과를 한 트랜잭션으로 반영합니다. 이미 반영한 결과는 그대로 두므로 다시 돌려도
 *   같습니다
 * - CMS에 닿지 못하면(`CmsUnavailable`) 실패로 남겨 재시도합니다. 그 전 출금일의 반영은 남습니다
 *
 * 결과는 읽은 출금일 수와 반영한(완료·실패) 결제 수, 아직 결과가 없는 결제 수입니다.
 */
export const withdrawalResultTask: ScheduledTask<Payments | CmsGateway | UnitOfWork> = {
  name: 'billing.withdrawal-results',
  spec: { kind: 'DAILY', at: '15:00' },
  run: () =>
    Effect.gen(function* () {
      const today = companyDate(yield* Clock.currentTimeMillis)
      const payments = yield* Payments
      const gateway = yield* CmsGateway
      const unitOfWork = yield* UnitOfWork
      const batches = yield* unitOfWork.run(payments.awaitingResults(today))
      let paid = 0
      let failed = 0
      let pending = 0
      for (const batch of batches) {
        const file = yield* gateway.withdrawalResults(
          batch.withdrawnOn,
          batch.payments.map((payment) => ({
            paymentId: payment.id,
            amount: payment.amount,
            mandateId: payment.mandateId,
          })),
        )
        if (Option.isNone(file)) {
          pending += batch.payments.length
          continue
        }
        const lines = file.value.filter((line) => batch.payments.some((payment) => payment.id === line.paymentId))
        yield* unitOfWork.run(
          Effect.forEach(
            lines,
            (line) =>
              payments.recordWithdrawal(line.paymentId as PaymentId, {
                succeeded: line.succeeded,
                ...(line.failureReason === undefined ? {} : { failureReason: line.failureReason }),
              }),
            { discard: true },
          ),
        )
        for (const line of lines) {
          if (line.succeeded) paid += 1
          else failed += 1
        }
        pending += batch.payments.length - lines.length
      }
      return { withdrawals: batches.length, paid, failed, pending }
    }),
}
