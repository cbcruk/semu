import { Context, Effect, Layer } from 'effect'
import { paginate } from '../../../shared/http/pagination.ts'
import type { PageOf, PageQuery } from '../../../shared/http/pagination.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { AgentCompany } from '../actor.types.ts'
import type { AgencyCompany } from './agency-company.ts'
import { AgencyWorkload } from './agency-workload.ts'

/** 담당 회사 목록 조건입니다. */
export interface AgencyCompanyQuery extends PageQuery {
  /** 이 담당자에게 배정된 회사만입니다. 팀장이 팀원별로 볼 때 씁니다. */
  assigneeId?: Id<'user'>
}

/** 대리인 작업 큐의 담당 회사 목록입니다. 일감 개수는 {@link AgencyWorkload} 포트로 Tax에서 받습니다. */
export class AgencyCompanies extends Context.Service<
  AgencyCompanies,
  {
    /** 담당 회사를 이름 순으로 돌려줍니다. `companies`는 인가를 통과한 회사입니다. */
    list(companies: ReadonlyArray<AgentCompany>, query: AgencyCompanyQuery): Effect.Effect<PageOf<AgencyCompany>>
  }
>()('semu/identity-access/AgencyCompanies') {
  static readonly layer = Layer.effect(
    AgencyCompanies,
    Effect.gen(function* () {
      const workload = yield* AgencyWorkload

      const list = Effect.fn('AgencyCompanies.list')(function* (
        companies: ReadonlyArray<AgentCompany>,
        query: AgencyCompanyQuery,
      ) {
        const selected = companies.filter(
          (company) => query.assigneeId === undefined || company.assigneeIds.includes(query.assigneeId),
        )
        const page = paginate(selected, (company) => `${company.name}|${company.companyId}`, query)
        const counts = yield* workload.of(page.items)
        return {
          ...page,
          items: page.items.map((company, index): AgencyCompany => {
            const { companyId: _, ...workloadFields } = counts[index]!
            return {
              id: company.companyId,
              name: company.name,
              businessType: company.businessType,
              plans: [...company.plans],
              assigneeIds: [...company.assigneeIds],
              workload: workloadFields,
            }
          }),
        }
      })

      return AgencyCompanies.of({ list })
    }),
  )
}
