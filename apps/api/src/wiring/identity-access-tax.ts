import { Effect, Layer } from 'effect'
import { AgencyWorkload } from '../modules/identity-access/identity-access.public.ts'
import { AgencyWorkloadQuery } from '../modules/tax/tax.public.ts'

/**
 * Identity & Access의 `AgencyWorkload` 포트를 Tax의 대리인 일감 조회(`AgencyWorkloadQuery`)로 구현합니다.
 *
 * 대리인 담당 회사 목록(`GET /agency/companies`)의 신고 건·할 일 카드 개수가 작업 큐(`GET /agency/filings`)와 같은 계산에서 나옵니다.
 * Identity & Access는 Tax 저장소를 읽지 않고, Tax는 배정을 모릅니다. 담당 회사와 그 플랜은 Identity & Access가 넘깁니다.
 */
export const IdentityAccessAgencyWorkloadFromTax: Layer.Layer<AgencyWorkload, never, AgencyWorkloadQuery> =
  Layer.effect(
    AgencyWorkload,
    Effect.gen(function* () {
      const tax = yield* AgencyWorkloadQuery
      return AgencyWorkload.of({ of: (companies) => tax.of(companies) })
    }),
  )
