import { Context, Effect, Layer, Option, Ref } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'

/** 명세서 발송 한 번의 기록입니다. */
export interface PayslipDelivery {
  status: 'SENT' | 'FAILED'
  failureReason: 'NO_EMAIL' | 'REJECTED' | null
  attemptedAt: string
}

/**
 * 명세서 레코드입니다. 금액은 저장하지 않고 마감된 대장 행에서 읽습니다. 여기에는 ID와 발송 기록만 있습니다.
 */
export interface PayslipRecord {
  id: Id<'payslip'>
  companyId: Id<'company'>
  ledgerId: Id<'payrollLedger'>
  rowId: Id<'payrollRow'>
  deliveries: PayslipDelivery[]
}

/** 명세서 발송 기록과 `Idempotency-Key` 응답 저장소입니다. */
export class PayslipRepository extends Context.Service<
  PayslipRepository,
  {
    listByLedger(companyId: Id<'company'>, ledgerId: Id<'payrollLedger'>): Effect.Effect<ReadonlyArray<PayslipRecord>>
    find(companyId: Id<'company'>, id: Id<'payslip'>): Effect.Effect<Option.Option<PayslipRecord>>
    save(record: PayslipRecord): Effect.Effect<void>
    /** 같은 회사·키로 이미 보낸 응답입니다. */
    replay(companyId: Id<'company'>, key: string): Effect.Effect<Option.Option<unknown>>
    remember(companyId: Id<'company'>, key: string, response: unknown): Effect.Effect<void>
  }
>()('semu/payroll/PayslipRepository') {
  /** 프로세스 메모리에 둡니다. 멱등 키는 만료하지 않습니다. */
  static readonly layerMemory = Layer.effect(
    PayslipRepository,
    Effect.gen(function* () {
      const store = yield* Ref.make(new Map<string, PayslipRecord>())
      const responses = yield* Ref.make(new Map<string, unknown>())
      return PayslipRepository.of({
        listByLedger: (companyId, ledgerId) =>
          Ref.get(store).pipe(
            Effect.map((map) =>
              [...map.values()].filter((record) => record.companyId === companyId && record.ledgerId === ledgerId),
            ),
          ),
        find: (companyId, id) =>
          Ref.get(store).pipe(
            Effect.map((map) =>
              Option.fromNullishOr(map.get(id)).pipe(Option.filter((record) => record.companyId === companyId)),
            ),
          ),
        save: (record) => Ref.update(store, (map) => new Map(map).set(record.id, record)),
        replay: (companyId, key) =>
          Ref.get(responses).pipe(Effect.map((map) => Option.fromNullishOr(map.get(`${companyId}:${key}`)))),
        remember: (companyId, key, response) =>
          Ref.update(responses, (map) => new Map(map).set(`${companyId}:${key}`, response)),
      })
    }),
  )
}
