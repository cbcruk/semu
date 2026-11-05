import { Effect, Layer } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { expectedVersion, withEtag } from '../../../shared/http/versioning.ts'
import { requirePermission } from '../common/wire.ts'
import { BankService } from './bank-service.ts'

const BankAccountsHttpLive = HttpApiBuilder.group(
  Api,
  'bankAccounts',
  Effect.fn(function* (handlers) {
    const bank = yield* BankService

    return handlers.handleAll({
      list: () =>
        Effect.flatMap(requirePermission('bank-account:read'), (actor) =>
          Effect.map(bank.listAccounts(actor.companyId), (items) => ({ items })),
        ),
      summary: () =>
        Effect.flatMap(requirePermission('bank-account:read'), (actor) => bank.summarizeAccounts(actor.companyId)),
      update: ({ params, headers, payload }) =>
        Effect.flatMap(requirePermission('bank-account:update'), (actor) =>
          bank
            .updateAccount(actor.companyId, params.bankAccountId, payload, expectedVersion(headers['if-match']))
            .pipe(Effect.map(withEtag)),
        ),
      balances: ({ params, query }) =>
        Effect.flatMap(requirePermission('bank-account:read'), (actor) =>
          bank.balances(actor.companyId, params.bankAccountId, query),
        ),
    })
  }),
)

const BankTransactionsHttpLive = HttpApiBuilder.group(
  Api,
  'bankTransactions',
  Effect.fn(function* (handlers) {
    const bank = yield* BankService

    return handlers.handleAll({
      list: ({ query: { limit, cursor, ...filter } }) =>
        Effect.flatMap(requirePermission('bank-transaction:read'), (actor) =>
          bank.listTransactions(actor.companyId, filter, {
            ...(limit === undefined ? {} : { limit }),
            ...(cursor === undefined ? {} : { cursor }),
          }),
        ),
      get: ({ params }) =>
        Effect.flatMap(requirePermission('bank-transaction:read'), (actor) =>
          bank.getTransaction(actor.companyId, params.bankTransactionId).pipe(Effect.map(withEtag)),
        ),
      update: ({ params, headers, payload }) =>
        Effect.flatMap(requirePermission('bank-transaction:update'), (actor) =>
          bank
            .updateTransaction(actor.companyId, params.bankTransactionId, payload, expectedVersion(headers['if-match']))
            .pipe(Effect.map(withEtag)),
        ),
      classify: ({ params, headers, payload }) =>
        Effect.flatMap(requirePermission('bank-transaction:classify'), (actor) =>
          bank
            .classifyTransaction(
              actor.companyId,
              params.bankTransactionId,
              payload,
              expectedVersion(headers['if-match']),
            )
            .pipe(Effect.map(withEtag)),
        ),
      batchClassify: ({ payload }) =>
        Effect.flatMap(requirePermission('bank-transaction:classify'), (actor) =>
          bank.batchClassify(actor.companyId, payload.bankTransactionIds, payload.accountTitleId),
        ),
      link: ({ params, headers, payload }) =>
        Effect.flatMap(requirePermission('bank-transaction:update'), (actor) =>
          bank
            .link(actor.companyId, params.bankTransactionId, payload.links, expectedVersion(headers['if-match']))
            .pipe(Effect.map(withEtag)),
        ),
    })
  }),
)

/** 은행 계좌·입출금 핸들러입니다. */
export const BankHttpLive = Layer.mergeAll(BankAccountsHttpLive, BankTransactionsHttpLive)
