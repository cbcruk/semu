import { Effect, Layer } from 'effect'
import { BusinessStatusCheck } from '../modules/identity-access/identity-access.public.ts'
import type { BusinessStatus } from '../modules/identity-access/identity-access.public.ts'
import { BusinessStatusClient } from '../modules/integrations/integrations.public.ts'
import type { BusinessStatusCode } from '../modules/integrations/integrations.public.ts'

const STATUS: Readonly<Record<BusinessStatusCode, BusinessStatus>> = {
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  CLOSED: 'CLOSED',
  UNREGISTERED: 'UNKNOWN',
}

/**
 * Identity & Access의 `BusinessStatusCheck` 포트를 Integrations의 국세청 사업자 상태조회(`BusinessStatusClient`)로 구현합니다.
 *
 * 회사 등록 전에 폐업을 막는 데 씁니다. 미등록(`UNREGISTERED`)은 `UNKNOWN`으로 옮깁니다. 조회 실패는 그대로 넘기고,
 * 허용할지는 Identity & Access가 정합니다.
 */
export const IdentityAccessBusinessStatusFromIntegrations: Layer.Layer<
  BusinessStatusCheck,
  never,
  BusinessStatusClient
> = Layer.effect(
  BusinessStatusCheck,
  Effect.gen(function* () {
    const client = yield* BusinessStatusClient
    return BusinessStatusCheck.of({
      statusOf: (businessNumber) => client.lookup(businessNumber).pipe(Effect.map((result) => STATUS[result.status])),
    })
  }),
)
