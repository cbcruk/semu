import { Context, Effect, Layer } from 'effect'
import { TableFactory } from '../../../shared/persistence/record-table.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'

/** 세무 대리인 담당자를 회사에 배정한 기록입니다. 배정은 대리인 내부 도구(데스크)가 만듭니다. */
export interface AgencyAssignment {
  companyId: Id<'company'>
  userId: Id<'user'>
  assignedAt: string
}

/** 저장한 배정입니다. (회사, 담당자)마다 하나라 ID는 `${companyId}:${userId}`입니다. */
interface StoredAssignment extends AgencyAssignment {
  readonly id: string
}

/** 세무 대리인 배정 저장소입니다. 이 API는 읽기만 합니다. */
export class AgencyAssignmentRepository extends Context.Service<
  AgencyAssignmentRepository,
  {
    /** 주어진 담당자들에게 배정된 회사입니다. 팀장은 자기와 팀원의 ID를 함께 넘깁니다. */
    companiesOf(userIds: ReadonlyArray<Id<'user'>>): Effect.Effect<Id<'company'>[]>
  }
>()('semu/identity-access/AgencyAssignmentRepository') {
  /** `iam_agency_assignments` 표에 둡니다. 표가 비어 있으면 `seed`로 시작합니다. */
  static readonly layer = (seed: ReadonlyArray<AgencyAssignment> = []) =>
    Layer.effect(
      AgencyAssignmentRepository,
      Effect.gen(function* () {
        const table = yield* (yield* TableFactory).make<StoredAssignment>('iam_agency_assignments', {
          seed: seed.map((assignment) => ({ ...assignment, id: `${assignment.companyId}:${assignment.userId}` })),
          companyOf: (assignment) => assignment.companyId,
        })
        return AgencyAssignmentRepository.of({
          companiesOf: (userIds) =>
            Effect.map(table.all(), (assignments) => [
              ...new Set(assignments.filter((a) => userIds.includes(a.userId)).map((a) => a.companyId)),
            ]),
        })
      }),
    )

  /** `seed`의 배정을 프로세스 메모리에 둡니다. */
  static readonly layerMemory = (seed: ReadonlyArray<AgencyAssignment> = []) =>
    AgencyAssignmentRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}
