import { Effect } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { AccountTitleRepository } from '../common/repositories.ts'
import { AccountTitleNotAssignable } from './account-title.ts'
import { assignabilityProblem, indexAccountTitles } from './account-title-tree.ts'
import type { AccountScope, AccountTitleInfo } from './account-title.types.ts'

/** 회사가 보는 계정과목 전체를 조상까지 풀어 둔 색인입니다. */
export const loadAccountTitleIndex = (
  companyId: Id<'company'>,
): Effect.Effect<Map<Id<'accountTitle'>, AccountTitleInfo>, never, AccountTitleRepository> =>
  Effect.flatMap(AccountTitleRepository, (repository) =>
    Effect.map(repository.list(companyId), (rows) => indexAccountTitles(rows)),
  )

/** 거래를 이 계정과목으로 분류할 수 있는지 확인합니다. 아니면 422입니다. */
export const ensureAssignable = (
  index: ReadonlyMap<Id<'accountTitle'>, AccountTitleInfo>,
  accountTitleId: Id<'accountTitle'>,
  scope: AccountScope,
): Effect.Effect<void, AccountTitleNotAssignable> => {
  const reason = assignabilityProblem(index, accountTitleId, scope)
  return reason === undefined ? Effect.void : Effect.fail(new AccountTitleNotAssignable({ reason, scope }))
}
