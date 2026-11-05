import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { expectedVersion, withEtag } from '../../../shared/http/versioning.ts'
import { authorize } from '../authorization.ts'
import { grantablePermissions, ROLE_TEMPLATES } from '../permissions/permission-catalog.ts'
import { Roles } from './roles.ts'

/** 권한 그룹 핸들러입니다. */
export const RolesHttpLive = HttpApiBuilder.group(
  Api,
  'roles',
  Effect.fn(function* (handlers) {
    const roles = yield* Roles
    return handlers.handleAll({
      list: () =>
        authorize({ permission: 'role:read' }).pipe(
          Effect.flatMap(roles.list),
          Effect.map((items) => ({ items })),
        ),
      create: ({ payload }) =>
        authorize({ permission: 'role:create' }).pipe(Effect.flatMap((actor) => roles.create(actor, payload))),
      get: ({ params }) =>
        authorize({ permission: 'role:read' }).pipe(
          Effect.flatMap((actor) => roles.get(actor, params.roleId)),
          Effect.map(withEtag),
        ),
      update: ({ params, headers, payload }) =>
        authorize({ permission: 'role:update' }).pipe(
          Effect.flatMap((actor) => roles.update(actor, params.roleId, payload, expectedVersion(headers['if-match']))),
          Effect.map(withEtag),
        ),
      remove: ({ params }) =>
        authorize({ permission: 'role:delete' }).pipe(Effect.flatMap((actor) => roles.remove(actor, params.roleId))),
      templates: () =>
        authorize({ permission: 'role:read' }).pipe(
          Effect.as({
            items: ROLE_TEMPLATES.map((template) => ({ ...template, permissions: [...template.permissions] })),
          }),
        ),
      permissions: () =>
        authorize({ permission: 'role:read' }).pipe(
          Effect.as({
            items: grantablePermissions().map((entry) => ({ ...entry, requiredPlans: [...entry.requiredPlans] })),
          }),
        ),
    })
  }),
)
