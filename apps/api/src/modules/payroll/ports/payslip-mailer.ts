import { Context, Effect, Layer } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'

/** 명세서 한 건을 보낸 결과입니다. */
export type PayslipMailResult = { ok: true } | { ok: false; reason: 'NO_EMAIL' | 'REJECTED' }

/**
 * 명세서 메일 발송 포트입니다. 운영에서는 Integrations의 메일 연동이 구현하고 PDF를 첨부합니다.
 */
export class PayslipMailer extends Context.Service<
  PayslipMailer,
  {
    send(message: { payslipId: Id<'payslip'>; to: string | null; subject: string }): Effect.Effect<PayslipMailResult>
  }
>()('semu/payroll/PayslipMailer') {
  /** 주소가 있으면 성공하고 없으면 `NO_EMAIL`로 실패하는 가짜입니다. */
  static readonly layerFake = Layer.succeed(
    PayslipMailer,
    PayslipMailer.of({
      send: (message) => Effect.succeed(message.to === null ? { ok: false, reason: 'NO_EMAIL' } : { ok: true }),
    }),
  )
}
