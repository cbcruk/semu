import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { EntitlementRequired, PermissionDenied } from '../../../shared/problem/problem.ts'
import { Authentication } from '../../identity-access/authentication.ts'
import {
  DelegationConsentRequest,
  DelegationNotFound,
  DelegationTransitionInvalid,
  HometaxConsentRejected,
  HometaxDelegation,
  HometaxDelegationId,
} from './hometax-delegation.ts'

/** 홈택스 세무대리인 수임동의입니다. 세무 기장(`TAXATION`) 고객만 씁니다. */
export class HometaxDelegationsApi extends HttpApiGroup.make('hometaxDelegations')
  .add(
    HttpApiEndpoint.get('list', '/hometax-delegations', {
      success: Schema.Struct({ items: Schema.Array(HometaxDelegation) }),
      error: [PermissionDenied, EntitlementRequired],
    }),
    HttpApiEndpoint.post('agree', '/hometax-delegations/:delegationId::agree', {
      params: { delegationId: HometaxDelegationId },
      payload: DelegationConsentRequest,
      success: HometaxDelegation,
      error: [
        PermissionDenied,
        EntitlementRequired,
        DelegationNotFound,
        DelegationTransitionInvalid,
        HometaxConsentRejected,
      ],
    }),
  )
  .middleware(Authentication) {}
