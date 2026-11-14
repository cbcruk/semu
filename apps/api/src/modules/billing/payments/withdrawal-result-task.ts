import { Clock, Effect, Option } from 'effect'
import { UnitOfWork } from '../../../shared/persistence/unit-of-work.ts'
import type { ScheduledTask } from '../../../shared/scheduler/scheduler.ts'
import { companyDate } from '../../../shared/time/company-date.ts'
import { CmsGateway, CmsUnavailable } from '../mandates/cms-gateway.ts'
import type { WithdrawalResultLine } from '../mandates/cms-gateway.ts'
import type { PaymentId } from './payment.ts'
import { Payments } from './payments.ts'

/**
 * 매일 15:00(회사 시간대)에 CMS 출금 결과 파일을 끌어와 결제에 반영합니다(`Payments.recordWithdrawal`). 결과 파일은 출금 다음 날
 * 오후에 오므로, 결과 반영일이 오늘이거나 지났는데 아직 `SCHEDULED`·`RETRYING`인 결제의 출금일마다 파일을 읽습니다.
 *
 * - 파일이 아직 없거나 파일에 없는 결제는 그대로 두고 다음 날 다시 읽습니다(`pending`)
 * - 결과 파일은 트랜잭션 밖에서 읽고, 출금일 하나의 결과를 한 트랜잭션으로 반영합니다. 이미 반영한 결과는 그대로 두므로 다시 돌려도
 *   같습니다
 * - CMS에 닿지 못한 출금일(`CmsUnavailable`)은 건너뛰고 다른 출금일은 계속 읽은 뒤, 하나라도 있었으면 실패로 남겨 재시도합니다.
 *   읽은 출금일의 반영은 남습니다
 * - 결과 파일의 같은 결제 줄은 처음 하나만 쓰고, 읽은 뒤 이미 반영된 결제는 반영 건수에 세지 않습니다
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
      let unavailable = 0
      for (const batch of batches) {
        // 한 출금일의 장애가 다른 출금일의 반영을 막지 않도록 출금일마다 받고, 끝에 모아 실패합니다.
        const file = yield* gateway
          .withdrawalResults(
            batch.withdrawnOn,
            batch.payments.map((payment) => ({
              paymentId: payment.id,
              amount: payment.amount,
              mandateId: payment.mandateId,
            })),
          )
          .pipe(Effect.option)
        if (Option.isNone(file)) {
          unavailable += 1
          continue
        }
        if (Option.isNone(file.value)) {
          pending += batch.payments.length
          continue
        }
        // 기다리는 결제의 줄만, 같은 결제는 처음 줄 하나만 씁니다.
        const lines = new Map<string, WithdrawalResultLine>()
        for (const line of file.value.value) {
          if (!lines.has(line.paymentId) && batch.payments.some((payment) => payment.id === line.paymentId)) {
            lines.set(line.paymentId, line)
          }
        }
        const applied = yield* unitOfWork.run(
          Effect.forEach([...lines.values()], (line) =>
            payments
              .recordWithdrawal(line.paymentId as PaymentId, {
                succeeded: line.succeeded,
                ...(line.failureReason === undefined ? {} : { failureReason: line.failureReason }),
              })
              .pipe(
                // 이번에 바꾼 결제만 셉니다. 상태 전이가 없으면(읽은 뒤 이미 반영됨) 버전이 그대로입니다.
                Effect.map(
                  Option.filter((record) => {
                    const before = batch.payments.find((payment) => payment.id === record.id)
                    return before !== undefined && record.version > before.version
                  }),
                ),
              ),
          ),
        )
        for (const record of applied) {
          if (Option.isNone(record)) continue
          if (record.value.status === 'PAID') paid += 1
          else if (record.value.status === 'FAILED') failed += 1
        }
        pending += batch.payments.length - lines.size
      }
      if (unavailable > 0) return yield* new CmsUnavailable()
      return { withdrawals: batches.length, paid, failed, pending }
    }),
}
