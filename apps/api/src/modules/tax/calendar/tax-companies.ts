import { Context, Effect, Layer, Option } from 'effect'
import type { BusinessType, Plan } from '../../identity-access/actor.types.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'

/** 세무 일정이 쓰는 회사 사실입니다. Tax가 정하지 않는 값이라 다른 컨텍스트에서 받습니다. */
export interface TaxCompany {
  companyId: Id<'company'>
  businessType: BusinessType
  plans: ReadonlyArray<Plan>
}

/**
 * 회사의 사업자 형태와 플랜을 읽는 포트입니다. `src/wiring/tax-identity-access.ts`가 Identity & Access의 회사와
 * Billing의 플랜으로 구현합니다. 일정 배치는 행위자 없이 돌기 때문에 회사 목록도 받습니다.
 */
export class TaxCompanies extends Context.Service<
  TaxCompanies,
  {
    get(companyId: Id<'company'>): Effect.Effect<Option.Option<TaxCompany>>
    /** 세무 기장(`TAXATION`) 회사 전체입니다. 신고 건은 이 회사들에만 만듭니다. */
    listTaxation(): Effect.Effect<ReadonlyArray<TaxCompany>>
  }
>()('semu/tax/TaxCompanies') {
  /** 정해 둔 회사로 답하는 가짜입니다. */
  static readonly layerMemory = (companies: ReadonlyArray<TaxCompany> = []) =>
    Layer.succeed(
      TaxCompanies,
      TaxCompanies.of({
        get: (companyId) =>
          Effect.succeed(Option.fromNullishOr(companies.find((company) => company.companyId === companyId))),
        listTaxation: () => Effect.succeed(companies.filter((company) => company.plans.includes('TAXATION'))),
      }),
    )
}
