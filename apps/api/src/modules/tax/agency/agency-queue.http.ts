import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { AgencyScope } from '../../identity-access/authorization.ts'
import { authorizeAgency } from '../../identity-access/authorization.ts'
import { CompanyNotFound } from '../../identity-access/companies/company.ts'
import { AgencyQueue } from './agency-queue.ts'
import type { QueueCompany } from './agency-queue.ts'

/**
 * 인가를 통과한 담당 회사입니다. `companyId`를 고르면 그 회사가 배정돼 있어야 합니다(아니면 404).
 *
 * 배정은 됐지만 요건의 플랜이 없는 회사는 404가 아니라 빈 목록입니다.
 */
function scopedCompanies(
  scope: AgencyScope,
  companyId: Id<'company'> | undefined,
): Effect.Effect<ReadonlyArray<QueueCompany>, CompanyNotFound> {
  if (companyId !== undefined && !scope.agent.companies.some((company) => company.companyId === companyId)) {
    return Effect.fail(new CompanyNotFound({}))
  }
  return Effect.succeed(scope.companies)
}

/** 대리인 작업 큐 핸들러입니다. 접근 요건은 회사 범위 목록과 같고, 요건을 갖춘 담당 회사만 읽습니다. */
export const AgencyQueueHttpLive = HttpApiBuilder.group(
  Api,
  'agencyQueue',
  Effect.fn(function* (handlers) {
    const queue = yield* AgencyQueue

    return handlers.handleAll({
      filings: ({ query }) =>
        Effect.gen(function* () {
          const scope = yield* authorizeAgency({ permission: 'filing:read', plans: ['TAXATION'] })
          const companies = yield* scopedCompanies(scope, query.companyId)
          const { open, overdue, ...rest } = query
          return yield* queue.filings(companies, {
            ...rest,
            ...(open === undefined ? {} : { open: open === 'true' }),
            ...(overdue === undefined ? {} : { overdue: overdue === 'true' }),
          })
        }),
      actionCards: ({ query }) =>
        Effect.gen(function* () {
          const scope = yield* authorizeAgency({ permission: 'action-card:read' })
          const companies = yield* scopedCompanies(scope, query.companyId)
          const { status, ...rest } = query
          return yield* queue.actionCards(companies, scope.agent.permissions, status ?? 'OPEN', rest)
        }),
    })
  }),
)
