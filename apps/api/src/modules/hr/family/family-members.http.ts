import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { expectedVersion, withEtag } from '../../../shared/http/versioning.ts'
import { decodeHeaderText } from '../../../shared/personal-data/access-reason.ts'
import { authorize } from '../../identity-access/authorization.ts'
import { hrAccess } from '../shared/hr-access.ts'
import { FamilyMembers } from './family-members.ts'

/** 가족 핸들러입니다. 가족은 직원 정보라 `employee:*` 권한을 쓰고, 주민번호 열람은 `employee:reveal-rrn`입니다. */
export const FamilyMembersHttpLive = HttpApiBuilder.group(
  Api,
  'hrFamilyMembers',
  Effect.fn(function* (handlers) {
    const family = yield* FamilyMembers
    const read = authorize(hrAccess('employee:read'))
    const write = authorize(hrAccess('employee:update'))

    return handlers.handleAll({
      list: ({ params }) => read.pipe(Effect.flatMap((actor) => family.list(actor, params.id))),
      create: ({ params, payload }) => write.pipe(Effect.flatMap((actor) => family.create(actor, params.id, payload))),
      get: ({ params }) =>
        read.pipe(
          Effect.flatMap((actor) => family.get(actor, params.familyMemberId)),
          Effect.map(withEtag),
        ),
      update: ({ params, headers, payload }) =>
        write.pipe(
          Effect.flatMap((actor) =>
            family.update(actor, params.familyMemberId, payload, expectedVersion(headers['if-match'])),
          ),
          Effect.map(withEtag),
        ),
      remove: ({ params }) => write.pipe(Effect.flatMap((actor) => family.remove(actor, params.familyMemberId))),
      revealRegistrationNumber: ({ params, headers }) =>
        authorize(hrAccess('employee:reveal-rrn')).pipe(
          Effect.flatMap((actor) =>
            family.revealRegistrationNumber(actor, params.familyMemberId, decodeHeaderText(headers['x-access-reason'])),
          ),
        ),
    })
  }),
)
