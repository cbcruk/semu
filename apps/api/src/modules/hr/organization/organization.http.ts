import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { expectedVersion, withEtag } from '../../../shared/http/versioning.ts'
import { authorize } from '../../identity-access/authorization.ts'
import { hrAccess } from '../shared/hr-access.ts'
import { Organization } from './organization-service.ts'

/** 부서·직위 핸들러입니다. */
export const OrganizationHttpLive = HttpApiBuilder.group(
  Api,
  'hrOrganization',
  Effect.fn(function* (handlers) {
    const organization = yield* Organization
    const read = authorize(hrAccess('organization:read'))
    const write = authorize(hrAccess('organization:update'))

    return handlers.handleAll({
      listDepartments: () =>
        read.pipe(
          Effect.flatMap((actor) => organization.list(actor.companyId, 'DEPARTMENT')),
          Effect.map((items) => ({ items })),
        ),
      createDepartment: ({ payload }) =>
        write.pipe(Effect.flatMap((actor) => organization.create(actor.companyId, 'DEPARTMENT', payload.name))),
      renameDepartment: ({ params, headers, payload }) =>
        write.pipe(
          Effect.flatMap((actor) =>
            organization.rename(
              actor.companyId,
              'DEPARTMENT',
              params.id,
              payload.name,
              expectedVersion(headers['if-match']),
            ),
          ),
          Effect.map(withEtag),
        ),
      deleteDepartment: ({ params }) =>
        write.pipe(Effect.flatMap((actor) => organization.remove(actor.companyId, 'DEPARTMENT', params.id))),
      reorderDepartments: ({ payload }) =>
        write.pipe(
          Effect.flatMap((actor) => organization.reorder(actor.companyId, 'DEPARTMENT', payload.ids)),
          Effect.map((items) => ({ items })),
        ),
      listPositions: () =>
        read.pipe(
          Effect.flatMap((actor) => organization.list(actor.companyId, 'POSITION')),
          Effect.map((items) => ({ items })),
        ),
      createPosition: ({ payload }) =>
        write.pipe(Effect.flatMap((actor) => organization.create(actor.companyId, 'POSITION', payload.name))),
      renamePosition: ({ params, headers, payload }) =>
        write.pipe(
          Effect.flatMap((actor) =>
            organization.rename(
              actor.companyId,
              'POSITION',
              params.id,
              payload.name,
              expectedVersion(headers['if-match']),
            ),
          ),
          Effect.map(withEtag),
        ),
      deletePosition: ({ params }) =>
        write.pipe(Effect.flatMap((actor) => organization.remove(actor.companyId, 'POSITION', params.id))),
      reorderPositions: ({ payload }) =>
        write.pipe(
          Effect.flatMap((actor) => organization.reorder(actor.companyId, 'POSITION', payload.ids)),
          Effect.map((items) => ({ items })),
        ),
    })
  }),
)
