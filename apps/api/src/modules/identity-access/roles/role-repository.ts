import { Context, Effect, Layer } from 'effect'
import { makeTenantTable, TableFactory } from '../../../shared/persistence/record-table.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { Option } from 'effect'
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
  /** `iam_roles` 표에 둡니다. 표가 비어 있으면 `seed`로 시작합니다. */
  static readonly layer = (seed: ReadonlyArray<RoleRecord> = []) =>
    Layer.effect(
      RoleRepository,
      Effect.gen(function* () {
        const table = yield* makeTenantTable<RoleRecord>('iam_roles', seed)
        return RoleRepository.of({
          find: (companyId, roleId) => table.find(companyId, roleId),
          listByCompany: (companyId) =>
            Effect.map(table.list(companyId), (roles) =>
              roles.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
            ),
          save: (role) => table.save(role),
          remove: (companyId, roleId) => table.remove(companyId, roleId),
        })
      }),
    )

  /** `seed`로 시작해 프로세스 메모리에 권한 그룹을 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<RoleRecord> = []) =>
    RoleRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}
