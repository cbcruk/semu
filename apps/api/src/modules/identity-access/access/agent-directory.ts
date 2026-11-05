import { Context, Effect, Layer, Option } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { UserRepository } from '../accounts/user-repository.ts'
import type { Agent, AgentCompany, AgentKind } from '../actor.types.ts'
import { AgencyAssignmentRepository } from '../agency/agency-assignment-repository.ts'
import { CompanyRepository } from '../companies/company-repository.ts'
import { actorPermissions } from './actor-permissions.ts'
import { CompanyPlans } from './company-plans.ts'

/** 사용자 종류가 세무 대리인인지입니다. 고객 사용자는 대리인 범위 토큰을 받을 수 없습니다. */
export function isAgentKind(kind: string): kind is AgentKind {
  return kind === 'AGENCY_STAFF' || kind === 'AGENCY_MANAGER'
}

/**
 * 담당 회사의 정렬 키입니다. 이름, 같으면 회사 ID 순이고, 문자열은 코드값으로 비교합니다.
 *
 * 구분자 `\u0000`은 어떤 글자보다 작아 앞부분이 같은 이름(`세무` < `세무 상점`)이 짧은 쪽부터 옵니다.
 * 목록 정렬과 커서(`paginate`의 `>` 비교)가 같은 키·같은 비교를 써야 페이지 사이에서 회사가 빠지지 않습니다.
 */
export function agentCompanyKey(company: { name: string; companyId: string }): string {
  return `${company.name}\u0000${company.companyId}`
}

/** 코드값 비교입니다. `localeCompare`와 달리 `paginate`의 커서 비교와 순서가 같습니다. */
export function compareCodePoints(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * 대리인 범위 요청의 행위자({@link Agent})를 계산합니다. `AgencyAuthentication`이 요청마다 부릅니다.
 *
 * 담당 회사는 본인 배정과, 팀장이면 팀원 배정의 합입니다. 회사 범위의 `ActorDirectory`와 같은 배정 규칙을 씁니다.
 * 토큰에 담지 않고 요청마다 계산하므로 배정·구독 변경이 바로 반영됩니다.
 */
export class AgentDirectory extends Context.Service<
  AgentDirectory,
  {
    /** 활성 대리인이면 그 대리인입니다. 없거나 비활성이거나 고객 사용자면 `None`입니다. */
    resolve(userId: Id<'user'>): Effect.Effect<Option.Option<Agent>>
  }
>()('semu/identity-access/AgentDirectory') {
  static readonly layer = Layer.effect(
    AgentDirectory,
    Effect.gen(function* () {
      const users = yield* UserRepository
      const companies = yield* CompanyRepository
      const assignments = yield* AgencyAssignmentRepository
      const plansSource = yield* CompanyPlans

      const resolve = Effect.fn('AgentDirectory.resolve')(function* (userId: Id<'user'>) {
        const found = yield* users.findById(userId)
        if (Option.isNone(found) || found.value.status !== 'ACTIVE') return Option.none<Agent>()
        const user = found.value
        if (!isAgentKind(user.kind)) return Option.none<Agent>()

        const team = user.kind === 'AGENCY_MANAGER' ? yield* users.listByManager(user.id) : []
        const assigned = yield* assignments.listByUsers([user.id, ...team.map((member) => member.id)])
        const assignees = new Map<Id<'company'>, Id<'user'>[]>()
        for (const assignment of assigned) {
          assignees.set(assignment.companyId, [...(assignees.get(assignment.companyId) ?? []), assignment.userId])
        }

        const result: AgentCompany[] = []
        for (const [companyId, assigneeIds] of assignees) {
          const company = yield* companies.findById(companyId)
          if (Option.isNone(company)) continue
          result.push({
            companyId,
            name: company.value.name,
            businessType: company.value.businessType,
            plans: yield* plansSource.plansOf(companyId),
            assigneeIds: assigneeIds.toSorted(),
          })
        }

        return Option.some<Agent>({
          userId: user.id,
          userKind: user.kind,
          permissions: actorPermissions({ kind: 'AGENCY' }),
          companies: result.toSorted((a, b) => compareCodePoints(agentCompanyKey(a), agentCompanyKey(b))),
        })
      })

      return AgentDirectory.of({ resolve })
    }),
  )
}
