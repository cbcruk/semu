import { Context, Effect, Layer } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { AgentCompany } from '../actor.types.ts'

/** 담당 회사 하나의 세무 일감 개수입니다. 대리인 회사 목록의 요약 칸이 됩니다. */
export interface CompanyWorkload {
  companyId: Id<'company'>
  /** 끝나지 않은(`SETTLED`·`CANCELED`가 아닌) 신고 건 수입니다. */
  openFilingCount: number
  /** 그중 기한이 지난 신고 건 수입니다. */
  overdueFilingCount: number
  /** 진행중인 할 일 카드 수입니다. 고객이 할 일이라 대리인이 독촉할 대상입니다. */
  openActionCardCount: number
  /** 끝나지 않은 신고 건의 가장 가까운 기한(신고 기한, 없으면 납부 기한)입니다. */
  nearestDueDate: string | null
}

/**
 * 담당 회사들의 세무 일감 개수를 주는 포트입니다. Tax가 공개 서비스로 구현하고 `src/wiring/identity-access-tax.ts`가 잇습니다.
 *
 * Identity & Access는 Tax 저장소를 읽지 않습니다. 회사마다 플랜을 함께 넘기고, 플랜에 따라 무엇을 셀지는 Tax가 정합니다.
 */
export class AgencyWorkload extends Context.Service<
  AgencyWorkload,
  {
    /** 넘긴 회사마다 하나씩, 같은 순서로 돌려줍니다. */
    of(companies: ReadonlyArray<AgentCompany>): Effect.Effect<ReadonlyArray<CompanyWorkload>>
  }
>()('semu/identity-access/AgencyWorkload') {
  /** 모든 회사의 일감이 0인 가짜입니다. Tax 없이 Identity & Access만 시험할 때 씁니다. */
  static readonly layerEmpty = Layer.succeed(
    AgencyWorkload,
    AgencyWorkload.of({
      of: (companies) =>
        Effect.succeed(
          companies.map((company) => ({
            companyId: company.companyId,
            openFilingCount: 0,
            overdueFilingCount: 0,
            openActionCardCount: 0,
            nearestDueDate: null,
          })),
        ),
    }),
  )
}
