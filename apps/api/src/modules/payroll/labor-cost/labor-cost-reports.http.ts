import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { authorize } from '../../identity-access/authorization.ts'
import { LEDGER_PLANS } from '../payroll-access.ts'
import { PayrollLaborCost } from './payroll-labor-cost.ts'

/** `labor-cost-reports` 그룹 핸들러입니다. 세무만 구독한 회사도 볼 수 있습니다. */
export const LaborCostReportsHttpLive = HttpApiBuilder.group(Api, 'labor-cost-reports', (handlers) =>
  Effect.gen(function* () {
    const laborCost = yield* PayrollLaborCost
    return handlers.handle('get', ({ params }) =>
      Effect.gen(function* () {
        const actor = yield* authorize({
          permission: 'labor-cost-report:read',
          plans: LEDGER_PLANS,
          requiresTerms: true,
        })
        return yield* laborCost.monthly(actor.companyId, params.year)
      }),
    )
  }),
)
