import { Clock, Effect, Option } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { cannotFail } from '../../../shared/http/versioning.ts'
import type { Permission } from '../../identity-access/actor.types.ts'
import { authorize } from '../../identity-access/authorization.ts'
import { CompanyProfiles } from '../ports/company-profiles.ts'
import { HometaxDelegationClient } from '../ports/hometax-delegation-client.ts'
import {
  delegationView,
  DelegationNotFound,
  DelegationRepository,
  DelegationTransitionInvalid,
  HometaxConsentRejected,
} from './hometax-delegation.ts'

const requireTaxation = (permission: Permission) =>
  authorize({ permission, plans: ['TAXATION'] }).pipe(cannotFail('TermsReagreementRequired'))

/** 홈택스 수임동의 핸들러입니다. */
export const HometaxDelegationsHttpLive = HttpApiBuilder.group(
  Api,
  'hometaxDelegations',
  Effect.fn(function* (handlers) {
    const repository = yield* DelegationRepository
    const client = yield* HometaxDelegationClient
    const profiles = yield* CompanyProfiles
    return handlers.handleAll({
      list: () =>
        requireTaxation('hometax-delegation:read').pipe(
          Effect.flatMap((actor) => repository.listByCompany(actor.companyId)),
          Effect.map((records) => ({ items: records.map(delegationView) })),
        ),
      agree: ({ params, payload }) =>
        Effect.gen(function* () {
          const actor = yield* requireTaxation('hometax-delegation:agree')
          const found = yield* repository.find(actor.companyId, params.delegationId)
          if (Option.isNone(found)) return yield* new DelegationNotFound({})
          const delegation = found.value
          if (delegation.status !== 'REQUESTED') {
            return yield* new DelegationTransitionInvalid({ currentStatus: delegation.status })
          }
          const company = yield* profiles.profileOf(actor.companyId).pipe(Effect.map(Option.getOrThrow), Effect.orDie)
          const outcome = yield* client.consent({
            businessNumber: company.businessNumber,
            agencyName: delegation.agencyName,
            hometaxLoginId: payload.hometaxLoginId,
            hometaxPassword: payload.hometaxPassword,
          })
          if (!outcome.ok) return yield* new HometaxConsentRejected({ reason: outcome.code })
          const agreed = {
            ...delegation,
            status: 'AGREED' as const,
            agreedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
            agreedBy: actor.userId,
          }
          yield* repository.save(agreed)
          return delegationView(agreed)
        }),
    })
  }),
)
