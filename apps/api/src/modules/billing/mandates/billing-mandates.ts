import { keepChanges } from '../../../shared/persistence/unit-of-work.ts'
import { Clock, Context, Effect, Layer } from 'effect'
import { newId } from '../../../shared/ids/ids.ts'
import type { Actor } from '../../identity-access/actor.types.ts'
import { nowIso } from '../billing-access.ts'
import { BillingMandateRepository } from './billing-mandate-repository.ts'
import { MandateRejected, maskAccountNumber } from './billing-mandate.ts'
import type { BillingMandate, BillingMandateRecord, MandateRegistration } from './billing-mandate.ts'
import { CmsGateway } from './cms-gateway.ts'

/** 저장한 출금 동의를 응답 형태로 바꿉니다. */
export function toBillingMandate(record: BillingMandateRecord): BillingMandate {
  return {
    id: record.id,
    bankCode: record.bankCode,
    accountNumberMasked: record.accountNumberMasked,
    accountHolder: record.accountHolder,
    source: record.source,
    status: record.status,
    ...(record.rejectionReason === undefined ? {} : { rejectionReason: record.rejectionReason }),
    createdAt: record.createdAt,
    ...(record.registeredAt === undefined ? {} : { registeredAt: record.registeredAt }),
  }
}

/** CMS 출금 동의 조회와 온라인 등록입니다. */
export class BillingMandates extends Context.Service<
  BillingMandates,
  {
    list(actor: Actor): Effect.Effect<BillingMandate[]>
    /**
     * 계좌를 CMS에 등록합니다. 받아들여지면 이전 `REGISTERED` 계좌는 `REVOKED`가 되고,
     * 거절되면 `REJECTED`로 남기고 {@link MandateRejected}로 실패합니다.
     */
    register(actor: Actor, input: MandateRegistration): Effect.Effect<BillingMandate, MandateRejected>
  }
>()('semu/billing/BillingMandates') {
  static readonly layer = Layer.effect(
    BillingMandates,
    Effect.gen(function* () {
      const repository = yield* BillingMandateRepository
      const gateway = yield* CmsGateway
      return BillingMandates.of({
        list: (actor) =>
          repository.listByCompany(actor.companyId).pipe(Effect.map((rows) => rows.map(toBillingMandate))),
        register: Effect.fn(function* (actor, input) {
          const now = yield* nowIso
          const result = yield* gateway.registerAccount(input)
          const base = {
            id: newId('billingMandate', yield* Clock.currentTimeMillis),
            companyId: actor.companyId,
            bankCode: input.bankCode,
            accountNumberMasked: maskAccountNumber(input.accountNumber),
            accountHolder: input.accountHolder,
            source: 'ONLINE' as const,
            createdAt: now,
          }
          if (!result.accepted) {
            yield* repository.save({ ...base, status: 'REJECTED', rejectionReason: result.reason })
            yield* keepChanges
            return yield* new MandateRejected({ mandateId: base.id, reason: result.reason })
          }
          const previous = yield* repository.listByCompany(actor.companyId)
          for (const mandate of previous.filter((row) => row.status === 'REGISTERED')) {
            yield* repository.save({ ...mandate, status: 'REVOKED' })
          }
          const record: BillingMandateRecord = {
            ...base,
            status: 'REGISTERED',
            gatewayReference: result.reference,
            registeredAt: now,
          }
          yield* repository.save(record)
          return toBillingMandate(record)
        }),
      })
    }),
  )
}
