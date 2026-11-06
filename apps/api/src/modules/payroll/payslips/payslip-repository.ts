import { Context, Effect, Layer, Option, Semaphore } from 'effect'
import { TableFactory } from '../../../shared/persistence/record-table.ts'
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

/** 발송 요청 하나에서 명세서 한 건의 결과입니다. */
export interface PayslipSendItem {
  payslipId: Id<'payslip'>
  status: 'SENT' | 'FAILED'
  failureReason: 'NO_EMAIL' | 'REJECTED' | null
}

/**
 * `Idempotency-Key` 하나로 받은 발송 요청입니다. ID는 {@link payslipSendId}(회사·행위자·키)입니다.
 *
 * - `IN_PROGRESS`: 처리 중입니다. 같은 키의 다른 요청은 409입니다
 * - `INTERRUPTED`: 중간에 멈췄습니다. 같은 키·같은 본문으로 다시 오면 `items`에 결과가 있는 명세서는 건너뛰고 나머지를 보냅니다
 * - `COMPLETED`: 끝났습니다. 같은 키·같은 본문이면 이 작업을 그대로 돌려줍니다
 *
 * `items[i]`는 본문 `payslipIds[i]`의 결과이고, 보낸 순서대로 하나씩 늘어납니다. `createdAt`부터 24시간이 지나면 없는 것으로 봅니다.
 */
export interface PayslipSendRecord {
  id: string
  companyId: Id<'company'>
  actorUserId: Id<'user'>
  key: string
  /** 요청 본문의 지문(`requestFingerprint`)입니다. */
  fingerprint: string
  status: 'IN_PROGRESS' | 'INTERRUPTED' | 'COMPLETED'
  jobId: Id<'job'>
  createdAt: string
  finishedAt: string | null
  items: PayslipSendItem[]
}

/** 발송 요청 기록의 ID입니다. 키는 회사와 행위자마다 따로입니다. */
export function payslipSendId(companyId: Id<'company'>, actorUserId: Id<'user'>, key: string): string {
  return `${companyId}:${actorUserId}:${key}`
}

/** 명세서 발송 기록과 `Idempotency-Key` 응답 저장소입니다. */
export class PayslipRepository extends Context.Service<
  PayslipRepository,
  {
    listByLedger(companyId: Id<'company'>, ledgerId: Id<'payrollLedger'>): Effect.Effect<ReadonlyArray<PayslipRecord>>
    find(companyId: Id<'company'>, id: Id<'payslip'>): Effect.Effect<Option.Option<PayslipRecord>>
    save(record: PayslipRecord): Effect.Effect<void>
    /**
     * 발송 요청 기록 `id`를 읽고 `decide`가 돌려준 기록으로 바꿉니다(`null`이면 그대로 둡니다). 읽기와 쓰기 사이에 같은 저장소의
     * 다른 `claimSend`·`saveSend`가 끼어들지 않으므로, 키 확인과 예약이 한 번에 일어납니다.
     */
    claimSend<A>(
      id: string,
      decide: (existing: Option.Option<PayslipSendRecord>) => readonly [A, PayslipSendRecord | null],
    ): Effect.Effect<A>
    saveSend(record: PayslipSendRecord): Effect.Effect<void>
    removeSend(id: string): Effect.Effect<void>
  }
>()('semu/payroll/PayslipRepository') {
  /**
   * 명세서는 `payroll_payslips`, 발송 요청 기록은 `payroll_payslip_sends` 표에 둡니다. 표가 비어 있으면 `seed`로 시작합니다.
   * 24시간이 지난 발송 요청 기록은 유스케이스가 없는 것으로 보고 덮어씁니다. 이전 `payroll_payslip_responses` 표는 더 읽지 않습니다.
   */
  static readonly layer = (seed: ReadonlyArray<PayslipRecord> = []) =>
    Layer.effect(
      PayslipRepository,
      Effect.gen(function* () {
        const factory = yield* TableFactory
        const payslips = yield* factory.make<PayslipRecord>('payroll_payslips', {
          seed,
          companyOf: (record) => record.companyId,
        })
        const sends = yield* factory.make<PayslipSendRecord>('payroll_payslip_sends', {
          companyOf: (record) => record.companyId,
        })
        // 메모리 표에는 트랜잭션이 없어, 동시에 온 같은 키의 확인과 예약이 섞이지 않게 줄을 세웁니다.
        // SQLite는 요청 트랜잭션이 이미 쓰기 잠금을 쥐고 있어 여기서는 기다릴 일이 없습니다.
        const sendLock = yield* Semaphore.make(1)
        return PayslipRepository.of({
          listByLedger: (companyId, ledgerId) =>
            Effect.map(payslips.byCompany(companyId), (records) =>
              records.filter((record) => record.ledgerId === ledgerId),
            ),
          find: (companyId, id) =>
            Effect.map(
              payslips.get(id),
              Option.filter((record) => record.companyId === companyId),
            ),
          save: (record) => payslips.put(record),
          claimSend: (id, decide) =>
            sendLock.withPermit(
              Effect.gen(function* () {
                const [result, next] = decide(yield* sends.get(id))
                if (next !== null) yield* sends.put(next)
                return result
              }),
            ),
          saveSend: (record) => sendLock.withPermit(sends.put(record)),
          removeSend: (id) => sendLock.withPermit(sends.remove(id)),
        })
      }),
    )

  /** 프로세스 메모리에 둡니다. */
  static readonly layerMemory = PayslipRepository.layer().pipe(Layer.provide(TableFactory.layerMemory))
}
