import { Clock, Context, Effect, Layer } from 'effect'
import { newId } from '../../../shared/ids/ids.ts'
import type { Actor } from '../../identity-access/actor.types.ts'
import { nowIso, today } from '../billing-access.ts'
import { ConsultationRepository } from './consultation-repository.ts'
import { ConsultationAlreadyOpen, ProductAlreadySubscribed } from './consultation.ts'
import type { Consultation, ConsultationRecord, ConsultationRequest } from './consultation.ts'

/** 저장한 상담 신청을 응답 형태로 바꿉니다. 동의 일자는 응답에 넣지 않습니다. */
export function toConsultation(record: ConsultationRecord): Consultation {
  return {
    id: record.id,
    products: record.products,
    status: record.status,
    name: record.name,
    phone: record.phone,
    email: record.email,
    ...(record.memo === undefined ? {} : { memo: record.memo }),
    createdAt: record.createdAt,
  }
}

/** 로그인한 회사의 도입 문의 접수입니다. 담당자 배정과 알림톡 안내는 데스크가 리드를 보고 합니다. */
export class Consultations extends Context.Service<
  Consultations,
  {
    request(
      actor: Actor,
      input: ConsultationRequest,
    ): Effect.Effect<Consultation, ConsultationAlreadyOpen | ProductAlreadySubscribed>
  }
>()('semu/billing/Consultations') {
  static readonly layer = Layer.effect(
    Consultations,
    Effect.gen(function* () {
      const repository = yield* ConsultationRepository
      return Consultations.of({
        request: Effect.fn(function* (actor, input) {
          const products = [...new Set(input.products)]
          const subscribed = products.filter((plan) => actor.plans.has(plan))
          if (subscribed.length === products.length) {
            return yield* new ProductAlreadySubscribed({ products: subscribed })
          }
          const open = (yield* repository.listByCompany(actor.companyId)).find(
            (row) => row.status !== 'CLOSED' && row.products.some((plan) => products.includes(plan)),
          )
          if (open !== undefined) return yield* new ConsultationAlreadyOpen({ consultationId: open.id })
          const date = yield* today
          const record: ConsultationRecord = {
            id: newId('lead', yield* Clock.currentTimeMillis),
            companyId: actor.companyId,
            requestedBy: actor.userId,
            products: products.filter((plan) => !actor.plans.has(plan)),
            status: 'NEW',
            name: input.name,
            phone: input.phone,
            email: input.email,
            memo: input.memo,
            privacyAgreedOn: date,
            thirdPartyAgreedOn: date,
            createdAt: yield* nowIso,
          }
          yield* repository.save(record)
          return toConsultation(record)
        }),
      })
    }),
  )
}
