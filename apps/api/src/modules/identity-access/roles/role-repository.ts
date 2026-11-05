import { Context, Effect, Layer, Option, Ref } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { RoleRecord } from './role.ts'

/** 권한 그룹 저장소입니다. 권한 그룹은 회사마다 따로 있습니다. */
export class RoleRepository extends Context.Service<
  RoleRepository,
  {
    find(companyId: Id<'company'>, roleId: Id<'role'>): Effect.Effect<Option.Option<RoleRecord>>
    listByCompany(companyId: Id<'company'>): Effect.Effect<RoleRecord[]>
    save(role: RoleRecord): Effect.Effect<void>
    remove(companyId: Id<'company'>, roleId: Id<'role'>): Effect.Effect<void>
  }
>()('semu/identity-access/RoleRepository') {
  /** `seed`로 시작해 프로세스 메모리에 권한 그룹을 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<RoleRecord> = []) =>
    Layer.effect(
      RoleRepository,
      Effect.gen(function* () {
        const store = yield* Ref.make(new Map(seed.map((role) => [role.id, role])))
        return RoleRepository.of({
          find: (companyId, roleId) =>
            Ref.get(store).pipe(
              Effect.map((roles) =>
                Option.filter(Option.fromNullishOr(roles.get(roleId)), (r) => r.companyId === companyId),
              ),
            ),
          listByCompany: (companyId) =>
            Ref.get(store).pipe(
              Effect.map((roles) =>
                [...roles.values()]
                  .filter((role) => role.companyId === companyId)
                  .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
              ),
            ),
          save: (role) => Ref.update(store, (roles) => new Map(roles).set(role.id, role)),
          remove: (companyId, roleId) =>
            Ref.update(store, (roles) => {
              if (roles.get(roleId)?.companyId !== companyId) return roles
              const next = new Map(roles)
              next.delete(roleId)
              return next
            }),
        })
      }),
    )
}
