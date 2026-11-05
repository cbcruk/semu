import { keepChanges } from '../../../shared/persistence/unit-of-work.ts'
import { Context, Effect, Layer, Option } from 'effect'
import { checkVersion } from '../../../shared/http/versioning.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { VersionMismatch } from '../../../shared/problem/problem.ts'
import { nowAndToday, orFail } from '../common/lookup.ts'
import { accountDigits } from '../common/masking.ts'
import { GiroPaymentRepository, GiroRepository } from '../common/repositories.ts'
import { AccountNumberCipher } from '../ports/account-number-cipher.ts'
import { GiroPaymentGateway } from '../ports/giro-payment-gateway.ts'
import { allowedGiroCommands, transitionGiro } from './giro-status.ts'
import type { GiroCommand, GiroRecord, GiroStatus } from './giro.types.ts'
import type { Giro } from './giro.ts'
import { GiroNotFound, GiroPaymentFailed, GiroTransitionInvalid } from './giro.ts'

/** 앱 납부 입력입니다. 비밀번호는 게이트웨이에 한 번 넘기고 저장하지 않습니다. */
export interface GiroPaymentInput {
  bankCode: string
  accountNumber: string
  accountPassword: string
}

function toGiro(row: GiroRecord): Giro {
  const { companyId: _company, ...rest } = row
  return { ...rest, history: [...row.history], allowedCommands: allowedGiroCommands(row.status) }
}

/** 인터넷지로 고지서 조회와 납부입니다. */
export class GiroService extends Context.Service<
  GiroService,
  {
    list(companyId: Id<'company'>, filter: { status?: GiroStatus }): Effect.Effect<Giro[]>
    summary(companyId: Id<'company'>): Effect.Effect<{ todoCount: number; todoAmount: number; unknownCount: number }>
    get(companyId: Id<'company'>, id: Id<'giro'>): Effect.Effect<Giro, GiroNotFound>
    /** 수동 완료와 숨김입니다. */
    apply(
      companyId: Id<'company'>,
      actorUserId: Id<'user'>,
      id: Id<'giro'>,
      command: Exclude<GiroCommand, 'PAY'>,
      input: { memo?: string; expectedVersion?: number },
    ): Effect.Effect<Giro, GiroNotFound | GiroTransitionInvalid | VersionMismatch>
    /** 앱에서 납부합니다. 같은 `Idempotency-Key`의 재시도는 처음 결과를 돌려줍니다. */
    pay(
      companyId: Id<'company'>,
      actorUserId: Id<'user'>,
      id: Id<'giro'>,
      idempotencyKey: string,
      input: GiroPaymentInput,
    ): Effect.Effect<Giro, GiroNotFound | GiroTransitionInvalid | GiroPaymentFailed>
  }
>()('semu/bookkeeping/GiroService') {
  static readonly layer = Layer.effect(
    GiroService,
    Effect.gen(function* () {
      const repository = yield* GiroRepository
      const payments = yield* GiroPaymentRepository
      const gateway = yield* GiroPaymentGateway
      const cipher = yield* AccountNumberCipher

      const find = (companyId: Id<'company'>, id: Id<'giro'>) =>
        orFail(repository.findById(companyId, id), () => new GiroNotFound({}))

      const transition = Effect.fn('GiroService.transition')(function* (
        row: GiroRecord,
        command: GiroCommand,
        actorUserId: Id<'user'>,
        memo: string,
      ) {
        const next = transitionGiro(row.status, command)
        if (next === undefined) {
          return yield* new GiroTransitionInvalid({ currentStatus: row.status, command })
        }
        const { now } = yield* nowAndToday
        const saved: GiroRecord = {
          ...row,
          status: next.to,
          doneReason: next.doneReason,
          memo: memo === '' ? row.memo : memo,
          statusChangedAt: now,
          history: [...row.history, { type: next.action, memo, actorUserId, at: now }],
          version: row.version + 1,
        }
        yield* repository.save(saved)
        return saved
      })

      return GiroService.of({
        list: (companyId, filter) =>
          Effect.map(repository.list(companyId), (rows) =>
            rows
              .filter((row) => filter.status === undefined || row.status === filter.status)
              .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.id.localeCompare(b.id))
              .map(toGiro),
          ),

        summary: (companyId) =>
          Effect.map(repository.list(companyId), (rows) => {
            const todo = rows.filter((row) => row.status === 'TODO')
            return {
              todoCount: todo.length,
              todoAmount: todo.reduce((sum, row) => sum + row.payAmount, 0),
              unknownCount: rows.filter((row) => row.status === 'UNKNOWN').length,
            }
          }),

        get: (companyId, id) => Effect.map(find(companyId, id), toGiro),

        apply: Effect.fn('GiroService.apply')(function* (companyId, actorUserId, id, command, input) {
          const row = yield* find(companyId, id)
          yield* checkVersion(row.version, input.expectedVersion)
          return toGiro(yield* transition(row, command, actorUserId, input.memo ?? ''))
        }),

        pay: Effect.fn('GiroService.pay')(function* (companyId, actorUserId, id, idempotencyKey, input) {
          const row = yield* find(companyId, id)
          const paymentId = `${id}:${idempotencyKey}`
          const previous = yield* payments.findById(companyId, paymentId)
          if (Option.isSome(previous)) {
            if (previous.value.status === 'FAILED') {
              return yield* new GiroPaymentFailed({
                resultCode: previous.value.resultCode ?? '',
                resultMessage: previous.value.resultMessage ?? '',
              })
            }
            return toGiro(row)
          }
          if (transitionGiro(row.status, 'PAY') === undefined) {
            return yield* new GiroTransitionInvalid({ currentStatus: row.status, command: 'PAY' })
          }
          const { now } = yield* nowAndToday
          const result = yield* gateway.pay({
            companyId,
            giroId: id,
            electronicPaymentNumber: row.electronicPaymentNumber,
            taxKind: row.taxKind,
            bankCode: input.bankCode,
            accountNumber: accountDigits(input.accountNumber),
            accountPassword: input.accountPassword,
            amount: row.payAmount,
            idempotencyKey,
          })
          yield* payments.save({
            id: paymentId,
            companyId,
            giroId: id,
            bankCode: input.bankCode,
            accountNumberEncrypted: cipher.encrypt(accountDigits(input.accountNumber)),
            accountNumberLast4: accountDigits(input.accountNumber).slice(-4),
            amount: row.payAmount,
            status: result.ok ? 'SUCCEEDED' : 'FAILED',
            resultCode: result.resultCode,
            resultMessage: result.resultMessage,
            requestedBy: actorUserId,
            createdAt: now,
          })
          if (!result.ok) {
            yield* repository.save({
              ...row,
              history: [...row.history, { type: 'PAYMENT_FAILED', memo: result.resultMessage, actorUserId, at: now }],
              version: row.version + 1,
            })
            // 실패 응답(4xx)이어도 납부 시도 기록은 남겨야 같은 멱등성 키로 다시 출금하지 않습니다.
            yield* keepChanges
            return yield* new GiroPaymentFailed({ resultCode: result.resultCode, resultMessage: result.resultMessage })
          }
          return toGiro(yield* transition(row, 'PAY', actorUserId, ''))
        }),
      })
    }),
  )
}
