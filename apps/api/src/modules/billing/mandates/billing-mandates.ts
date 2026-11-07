import { keepChanges } from '../../../shared/persistence/unit-of-work.ts'
import { Clock, Context, Effect, Layer } from 'effect'
import { outcomeUnknownOnDefect, runIdempotent } from '../../../shared/http/idempotency.ts'
import { newId } from '../../../shared/ids/ids.ts'
import type {
  ExternalOutcomeUnknown,
  IdempotencyKeyInProgress,
  IdempotencyKeyRequired,
  IdempotencyKeyReused,
} from '../../../shared/problem/problem.ts'
import type { Actor } from '../../identity-access/actor.types.ts'
import { nowIso } from '../billing-access.ts'
import { BillingIdempotency } from '../billing-idempotency.ts'
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
     *
     * `Idempotency-Key`는 회사·행위자마다 따로입니다. 같은 키·같은 본문으로 24시간 안에 다시 오면 처음 응답을 돌려줍니다. 거절되면
     * 키를 남기지 않아 같은 키로 계좌를 고쳐 다시 보낼 수 있습니다. 은행 응답을 확인하지 못하면 503 `EXTERNAL_OUTCOME_UNKNOWN`이고,
     * 같은 키·같은 본문의 재시도는 같은 `requestId`로 CMS에 다시 묻습니다.
     */
    register(
      actor: Actor,
      input: MandateRegistration,
      idempotencyKey: string | undefined,
    ): Effect.Effect<
      BillingMandate,
      | MandateRejected
      | IdempotencyKeyRequired
      | IdempotencyKeyReused
      | IdempotencyKeyInProgress
      | ExternalOutcomeUnknown
    >
  }
>()('semu/billing/BillingMandates') {
  static readonly layer = Layer.effect(
    BillingMandates,
    Effect.gen(function* () {
      const repository = yield* BillingMandateRepository
      const gateway = yield* CmsGateway
      const idempotency = yield* BillingIdempotency
      return BillingMandates.of({
        list: (actor) =>
          repository.listByCompany(actor.companyId).pipe(Effect.map((rows) => rows.map(toBillingMandate))),
        register: (actor, input, idempotencyKey) =>
          runIdempotent(
            {
              store: idempotency,
              companyId: actor.companyId,
              actorUserId: actor.userId,
              key: idempotencyKey,
              operation: 'billing-mandate.register',
              // 계좌번호 전체와 납부자 번호는 지문에도 넣지 않습니다. 지문은 저장되고 짧은 값의 해시는 거꾸로 찾을 수 있습니다.
              request: {
                bankCode: input.bankCode,
                accountNumberMasked: maskAccountNumber(input.accountNumber),
                accountHolder: input.accountHolder,
              },
            },
            (attempt) =>
              outcomeUnknownOnDefect(
                'billing-mandate.register',
                Effect.gen(function* () {
                  const now = yield* nowIso
                  const result = yield* gateway.registerAccount({ ...input, requestId: attempt.reference })
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
              ),
          ),
      })
    }),
  )
}
