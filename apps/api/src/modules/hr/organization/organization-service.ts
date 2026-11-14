import { Context, Effect, Layer, Option } from 'effect'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { checkVersion } from '../../../shared/http/versioning.ts'
import type { VersionMismatch } from '../../../shared/problem/problem.ts'
import { EmployeeRepository } from '../employees/employee-repository.ts'
import { decideUnitCreation, decideUnitRemoval, decideUnitRename, decideUnitReorder } from './organization.aggregate.ts'
import { isOrganizationUnitInUse } from './organization-rules.ts'
import {
  OrganizationRepository,
  OrganizationUnitNotFound,
  type OrganizationNameTaken,
  type OrganizationOrderMismatch,
  type OrganizationUnitInUse,
  type OrganizationUnitKind,
  type OrganizationUnitRecord,
} from './organization.ts'

/** 부서·직위 응답 하나입니다. */
export interface OrganizationUnitView {
  id: string
  name: string
  order: number
  inUse: boolean
  version: number
}

/** 부서·직위 관리입니다. 두 종류가 같은 규칙을 씁니다. */
export class Organization extends Context.Service<
  Organization,
  {
    list(companyId: Id<'company'>, kind: OrganizationUnitKind): Effect.Effect<OrganizationUnitView[]>
    create(
      companyId: Id<'company'>,
      kind: OrganizationUnitKind,
      name: string,
    ): Effect.Effect<OrganizationUnitView, OrganizationNameTaken>
    rename(
      companyId: Id<'company'>,
      kind: OrganizationUnitKind,
      id: string,
      name: string,
      expectedVersion: number | undefined,
    ): Effect.Effect<OrganizationUnitView, OrganizationUnitNotFound | OrganizationNameTaken | VersionMismatch>
    remove(
      companyId: Id<'company'>,
      kind: OrganizationUnitKind,
      id: string,
    ): Effect.Effect<void, OrganizationUnitNotFound | OrganizationUnitInUse>
    reorder(
      companyId: Id<'company'>,
      kind: OrganizationUnitKind,
      ids: ReadonlyArray<string>,
    ): Effect.Effect<OrganizationUnitView[], OrganizationOrderMismatch>
  }
>()('semu/hr/Organization') {
  static readonly layer = Layer.effect(
    Organization,
    Effect.gen(function* () {
      const units = yield* OrganizationRepository
      const employees = yield* EmployeeRepository

      const unitsOf = (companyId: Id<'company'>, kind: OrganizationUnitKind) =>
        units
          .list(companyId)
          .pipe(Effect.map((all) => all.filter((unit) => unit.kind === kind).sort((a, b) => a.order - b.order)))

      const view = (unit: OrganizationUnitRecord): Effect.Effect<OrganizationUnitView> =>
        assignedCount(unit).pipe(
          Effect.map((assigned) => ({
            id: unit.id,
            name: unit.name,
            order: unit.order,
            inUse: isOrganizationUnitInUse({ everAssigned: unit.everAssigned, assignedEmployeeCount: assigned }),
            version: unit.version,
          })),
        )

      const find = (companyId: Id<'company'>, kind: OrganizationUnitKind, id: string) =>
        units.find(companyId, id).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.fail(new OrganizationUnitNotFound({})),
              onSome: (unit) =>
                unit.kind === kind ? Effect.succeed(unit) : Effect.fail(new OrganizationUnitNotFound({})),
            }),
          ),
        )

      const assignedCount = (unit: OrganizationUnitRecord) =>
        employees
          .list(unit.companyId)
          .pipe(
            Effect.map(
              (all) =>
                all.filter((employee) =>
                  unit.kind === 'DEPARTMENT' ? employee.departmentId === unit.id : employee.positionId === unit.id,
                ).length,
            ),
          )

      return Organization.of({
        list: (companyId, kind) => unitsOf(companyId, kind).pipe(Effect.flatMap((all) => Effect.forEach(all, view))),
        create: Effect.fn('Organization.create')(function* (companyId, kind, name) {
          const { unit } = yield* Effect.fromResult(
            decideUnitCreation(
              { id: kind === 'DEPARTMENT' ? newId('department') : newId('position'), companyId, kind, name },
              yield* unitsOf(companyId, kind),
            ),
          )
          yield* units.save(unit)
          return yield* view(unit)
        }),
        rename: Effect.fn('Organization.rename')(function* (companyId, kind, id, name, expectedVersion) {
          const current = yield* find(companyId, kind, id)
          yield* checkVersion(current.version, expectedVersion)
          const { unit } = yield* Effect.fromResult(decideUnitRename(current, name, yield* unitsOf(companyId, kind)))
          yield* units.save(unit)
          return yield* view(unit)
        }),
        remove: Effect.fn('Organization.remove')(function* (companyId, kind, id) {
          const unit = yield* find(companyId, kind, id)
          yield* Effect.fromResult(decideUnitRemoval(unit, yield* assignedCount(unit)))
          yield* units.remove(companyId, id)
        }),
        reorder: Effect.fn('Organization.reorder')(function* (companyId, kind, ids) {
          const decision = yield* Effect.fromResult(decideUnitReorder(yield* unitsOf(companyId, kind), ids))
          yield* Effect.forEach(decision.units, units.save, { discard: true })
          return yield* unitsOf(companyId, kind).pipe(Effect.flatMap((all) => Effect.forEach(all, view)))
        }),
      })
    }),
  )
}
