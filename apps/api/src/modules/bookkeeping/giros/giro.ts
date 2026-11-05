import { Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import { problemType } from '../../../shared/problem/problem.ts'
import { IdSchema } from '../../../shared/ids/id-schema.ts'
import { GiroId } from '../common/ids.ts'
import { CalendarDate, Won } from '../common/wire.ts'

/** 고지서 상태입니다. */
export const GiroStatus = Schema.Literals(['TODO', 'UNKNOWN', 'DONE', 'HIDDEN'])

/** 고지서 커맨드입니다. */
export const GiroCommand = Schema.Literals(['MARK_PAID', 'HIDE', 'PAY'])

/** 지로 고지서입니다. 기관마다 다른 원문은 `detail`에 그대로 둡니다. */
export const Giro = Schema.Struct({
  id: GiroId,
  electronicPaymentNumber: Schema.String,
  taxKind: Schema.Literals(['NATIONAL', 'LOCAL']),
  slipType: Schema.String,
  taxName: Schema.String,
  billingOrganization: Schema.NullOr(Schema.String),
  payAmount: Won,
  dueDate: Schema.NullOr(CalendarDate),
  status: GiroStatus,
  doneReason: Schema.NullOr(Schema.Literals(['PAID_IN_APP', 'MARKED_BY_USER', 'SEEN_PAID'])),
  memo: Schema.String,
  statusChangedAt: Schema.String,
  /** 지금 상태에서 보낼 수 있는 커맨드입니다. */
  allowedCommands: Schema.Array(GiroCommand),
  detail: Schema.Record(Schema.String, Schema.Unknown),
  history: Schema.Array(
    Schema.Struct({
      type: Schema.String,
      memo: Schema.String,
      actorUserId: Schema.NullOr(IdSchema('user')),
      at: Schema.String,
    }),
  ),
  version: Schema.Int,
})

export type Giro = typeof Giro.Type

/** 요청한 고지서가 없습니다. */
export class GiroNotFound extends HttpApiError.Problem<GiroNotFound>()(
  'GiroNotFound',
  { type: problemType('GIRO_NOT_FOUND'), status: 404, title: 'Giro bill not found' },
  { code: Schema.tag('GIRO_NOT_FOUND') },
) {}

/** 지금 상태에서 할 수 없는 커맨드입니다. */
export class GiroTransitionInvalid extends HttpApiError.Problem<GiroTransitionInvalid>()(
  'GiroTransitionInvalid',
  { type: problemType('GIRO_TRANSITION_INVALID'), status: 409, title: 'Giro status does not allow this command' },
  { code: Schema.tag('GIRO_TRANSITION_INVALID'), currentStatus: GiroStatus, command: GiroCommand },
) {}

/** 금융결제원이 납부를 거절했습니다. 고지서 상태는 그대로입니다. */
export class GiroPaymentFailed extends HttpApiError.Problem<GiroPaymentFailed>()(
  'GiroPaymentFailed',
  { type: problemType('GIRO_PAYMENT_FAILED'), status: 422, title: 'Giro payment was rejected' },
  { code: Schema.tag('GIRO_PAYMENT_FAILED'), resultCode: Schema.String, resultMessage: Schema.String },
) {}
