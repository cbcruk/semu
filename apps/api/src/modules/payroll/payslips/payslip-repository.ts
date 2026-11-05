import { Context, Effect, Layer, Option } from 'effect'
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

/** 같은 회사·`Idempotency-Key`로 처음 보낸 응답입니다. ID는 `<회사 ID>:<키>`입니다. */
interface StoredPayslipResponse {
  id: string
  companyId: Id<'company'>
  response: unknown
}

function responseId(companyId: Id<'company'>, key: string): string {
  return `${companyId}:${key}`
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
  /**
   * 명세서는 `payroll_payslips`, 멱등 응답은 `payroll_payslip_responses` 표에 둡니다. 멱등 키는 만료하지 않습니다.
   * 표가 비어 있으면 `seed`로 시작합니다. 응답은 JSON으로 저장하므로 일반 데이터여야 합니다.
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
        const responses = yield* factory.make<StoredPayslipResponse>('payroll_payslip_responses', {
          companyOf: (record) => record.companyId,
        })
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
          replay: (companyId, key) =>
            Effect.map(
              responses.get(responseId(companyId, key)),
              Option.map((record) => record.response),
            ),
          remember: (companyId, key, response) =>
            responses.put({ id: responseId(companyId, key), companyId, response }),
        })
      }),
    )

  /** 프로세스 메모리에 둡니다. 멱등 키는 만료하지 않습니다. */
  static readonly layerMemory = PayslipRepository.layer().pipe(Layer.provide(TableFactory.layerMemory))
}
