import { Context, Effect, Layer } from 'effect'
import { checkVersion } from '../../../shared/http/versioning.ts'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { VersionMismatch } from '../../../shared/problem/problem.ts'
import { orFail } from '../common/lookup.ts'
import {
  AccountTitleRepository,
  BankTransactionRepository,
  ClassificationRuleRepository,
  EvidenceRepository,
} from '../common/repositories.ts'
import type { AccountTitle } from './account-title.ts'
import {
  AccountTitleDepthExceeded,
  AccountTitleHasChildren,
  AccountTitleMoveTargetInvalid,
  AccountTitleNameDuplicate,
  AccountTitleNotFound,
  AccountTitleSystemLocked,
} from './account-title.ts'
import { deletionProblem, flattenAccountTitles, indexAccountTitles, planChildCreation } from './account-title-tree.ts'
import type { AccountScope, AccountTitleRecord } from './account-title.types.ts'

/** 계정과목 추가 결과입니다. */
export interface AccountTitleCreation {
  accountTitle: AccountTitle
  /** 상위 계정의 거래를 옮기려고 함께 만든 `기타 {상위명}`입니다. */
  autoCreatedEtc: AccountTitle | null
  /** `기타`로 옮긴 증빙·입출금 수입니다. */
  movedCount: number
}

/** 저장한 계정과목을 응답 모양으로 바꿉니다. */
function toAccountTitle(row: AccountTitleRecord, selectable: boolean): AccountTitle {
  return {
    id: row.id,
    parentId: row.parentId,
    depth: row.depth,
    code: row.code,
    name: row.name,
    description: row.description,
    appliesTo: [...row.appliesTo],
    plCategory: row.plCategory,
    cashCategory: row.cashCategory,
    origin: row.origin,
    selectable,
    version: row.version,
  }
}

/** 계정과목 트리 관리입니다. 기본 계정 아래에 회사 계정을 붙이고, 지울 때 거래를 옮깁니다. */
export class AccountTitleService extends Context.Service<
  AccountTitleService,
  {
    list(companyId: Id<'company'>, filter: { appliesTo?: AccountScope; search?: string }): Effect.Effect<AccountTitle[]>
    create(
      companyId: Id<'company'>,
      input: { parentId: Id<'accountTitle'>; name: string; description?: string },
    ): Effect.Effect<AccountTitleCreation, AccountTitleNotFound | AccountTitleDepthExceeded | AccountTitleNameDuplicate>
    update(
      companyId: Id<'company'>,
      id: Id<'accountTitle'>,
      changes: { name?: string; description?: string | null },
      expectedVersion: number | undefined,
    ): Effect.Effect<
      AccountTitle,
      AccountTitleNotFound | AccountTitleSystemLocked | AccountTitleNameDuplicate | VersionMismatch
    >
    remove(
      companyId: Id<'company'>,
      id: Id<'accountTitle'>,
      moveToId: Id<'accountTitle'> | undefined,
    ): Effect.Effect<
      { movedCount: number },
      AccountTitleNotFound | AccountTitleSystemLocked | AccountTitleHasChildren | AccountTitleMoveTargetInvalid
    >
  }
>()('semu/bookkeeping/AccountTitleService') {
  static readonly layer = Layer.effect(
    AccountTitleService,
    Effect.gen(function* () {
      const repository = yield* AccountTitleRepository
      const evidence = yield* EvidenceRepository
      const transactions = yield* BankTransactionRepository
      const rules = yield* ClassificationRuleRepository

      const view = (rows: ReadonlyArray<AccountTitleRecord>) => {
        const index = indexAccountTitles(rows)
        return (row: AccountTitleRecord): AccountTitle => toAccountTitle(row, index.get(row.id)?.selectable ?? false)
      }

      const find = (companyId: Id<'company'>, id: Id<'accountTitle'>) =>
        orFail(repository.findById(companyId, id), () => new AccountTitleNotFound({}))

      /** 계정과목으로 분류된 증빙·입출금을 다른 계정으로 옮깁니다. 옮긴 수를 돌려줍니다. */
      const moveClassified = Effect.fn('AccountTitleService.moveClassified')(function* (
        companyId: Id<'company'>,
        from: Id<'accountTitle'>,
        to: Id<'accountTitle'>,
      ) {
        const move = <R extends { classification: { accountTitleId: Id<'accountTitle'> | null }; version: number }>(
          rows: ReadonlyArray<R>,
        ): R[] =>
          rows
            .filter((row) => row.classification.accountTitleId === from)
            .map((row) => ({
              ...row,
              classification: { ...row.classification, accountTitleId: to },
              version: row.version + 1,
            }))
        const movedEvidence = move(yield* evidence.list(companyId))
        const movedTransactions = move(yield* transactions.list(companyId))
        yield* evidence.saveAll(movedEvidence)
        yield* transactions.saveAll(movedTransactions)
        return movedEvidence.length + movedTransactions.length
      })

      const classifiedCount = Effect.fn('AccountTitleService.classifiedCount')(function* (
        companyId: Id<'company'>,
        id: Id<'accountTitle'>,
      ) {
        const rows = [...(yield* evidence.list(companyId)), ...(yield* transactions.list(companyId))]
        return rows.filter((row) => row.classification.accountTitleId === id).length
      })

      return AccountTitleService.of({
        list: (companyId, filter) =>
          Effect.map(repository.list(companyId), (rows) => flattenAccountTitles(rows, filter).map(view(rows))),

        create: Effect.fn('AccountTitleService.create')(function* (companyId, input) {
          const parent = yield* find(companyId, input.parentId)
          const rows = yield* repository.list(companyId)
          const siblings = rows.filter((row) => row.parentId === parent.id)
          const plan = planChildCreation({
            parent,
            siblingNames: siblings.map((row) => row.name),
            classifiedCount: yield* classifiedCount(companyId, parent.id),
            name: input.name,
          })
          if (!plan.ok) {
            return yield* plan.code === 'DEPTH_EXCEEDED'
              ? Effect.fail(new AccountTitleDepthExceeded({}))
              : Effect.fail(new AccountTitleNameDuplicate({}))
          }
          let sortOrder = Math.max(parent.sortOrder * 100, ...siblings.map((row) => row.sortOrder))
          const child = (name: string, origin: 'COMPANY' | 'AUTO_ETC', description: string | null) => ({
            id: newId('accountTitle'),
            companyId,
            parentId: parent.id,
            depth: plan.depth,
            code: null,
            name,
            description,
            appliesTo: parent.appliesTo,
            plCategory: parent.plCategory,
            cashCategory: parent.cashCategory,
            origin,
            sortOrder: ++sortOrder,
            version: 1,
          })
          const autoEtc: AccountTitleRecord | null = plan.createAutoEtc
            ? child(plan.autoEtcName, 'AUTO_ETC', `${parent.name} 하위 계정이 생기기 전에 분류한 거래`)
            : null
          const created: AccountTitleRecord = child(input.name, 'COMPANY', input.description ?? null)
          yield* repository.saveAll(autoEtc === null ? [created] : [autoEtc, created])
          const movedCount = autoEtc === null ? 0 : yield* moveClassified(companyId, parent.id, autoEtc.id)
          const toView = view(yield* repository.list(companyId))
          return {
            accountTitle: toView(created),
            autoCreatedEtc: autoEtc === null ? null : toView(autoEtc),
            movedCount,
          }
        }),

        update: Effect.fn('AccountTitleService.update')(function* (companyId, id, changes, expectedVersion) {
          const row = yield* find(companyId, id)
          yield* checkVersion(row.version, expectedVersion)
          if (row.origin === 'SYSTEM') return yield* new AccountTitleSystemLocked({})
          const rows = yield* repository.list(companyId)
          if (
            changes.name !== undefined &&
            rows.some((other) => other.parentId === row.parentId && other.id !== row.id && other.name === changes.name)
          ) {
            return yield* new AccountTitleNameDuplicate({})
          }
          const next: AccountTitleRecord = {
            ...row,
            ...(changes.name === undefined ? {} : { name: changes.name }),
            ...(changes.description === undefined ? {} : { description: changes.description }),
            version: row.version + 1,
          }
          yield* repository.save(next)
          return view(rows.map((other) => (other.id === next.id ? next : other)))(next)
        }),

        remove: Effect.fn('AccountTitleService.remove')(function* (companyId, id, moveToId) {
          const target = yield* find(companyId, id)
          const rows = yield* repository.list(companyId)
          const count = yield* classifiedCount(companyId, id)
          const problem = deletionProblem({
            target,
            hasChildren: rows.some((row) => row.parentId === id),
            classifiedCount: count,
            moveToId,
            index: indexAccountTitles(rows),
          })
          if (problem === 'SYSTEM_LOCKED') return yield* new AccountTitleSystemLocked({})
          if (problem === 'HAS_CHILDREN') return yield* new AccountTitleHasChildren({})
          if (problem !== undefined) {
            return yield* new AccountTitleMoveTargetInvalid({ reason: problem, classifiedCount: count })
          }
          const movedCount = moveToId === undefined ? 0 : yield* moveClassified(companyId, id, moveToId)
          const pointing = (yield* rules.list(companyId)).filter((rule) => rule.resultAccountTitleId === id)
          yield* rules.saveAll(
            pointing.map((rule) => ({ ...rule, resultAccountTitleId: moveToId ?? null, version: rule.version + 1 })),
          )
          yield* repository.remove(companyId, id)
          return { movedCount }
        }),
      })
    }),
  )
}
