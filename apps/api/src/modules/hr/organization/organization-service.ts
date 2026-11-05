import { Context, Effect, Layer, Option } from 'effect'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { checkVersion } from '../../../shared/http/versioning.ts'
import type { VersionMismatch } from '../../../shared/problem/problem.ts'
import { EmployeeRepository } from '../employees/employee-repository.ts'
import { isOrganizationNameTaken, isOrganizationUnitInUse } from './organization-rules.ts'
import {
  OrganizationNameTaken,
  OrganizationOrderMismatch,
  OrganizationRepository,
  OrganizationUnitInUse,
  OrganizationUnitNotFound,
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

      const view = (unit: OrganizationUnitRecord) =>
        employees.list(unit.companyId).pipe(
          Effect.map((all) => {
            const assigned = all.filter((employee) =>
              unit.kind === 'DEPARTMENT' ? employee.departmentId === unit.id : employee.positionId === unit.id,
            ).length
            return {
              id: unit.id,
              name: unit.name,
              order: unit.order,
              inUse: isOrganizationUnitInUse({ everAssigned: unit.everAssigned, assignedEmployeeCount: assigned }),
              version: unit.version,
            }
          }),
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

      return Organization.of({
        list: (companyId, kind) => unitsOf(companyId, kind).pipe(Effect.flatMap((all) => Effect.forEach(all, view))),
        create: Effect.fn('Organization.create')(function* (companyId, kind, name) {
          const existing = yield* unitsOf(companyId, kind)
          if (isOrganizationNameTaken(name, existing)) return yield* new OrganizationNameTaken({})
          const unit: OrganizationUnitRecord = {
            id: kind === 'DEPARTMENT' ? newId('department') : newId('position'),
            companyId,
            kind,
            name: name.trim(),
            order: existing.length,
            everAssigned: false,
            version: 1,
          }
          yield* units.save(unit)
          return yield* view(unit)
        }),
        rename: Effect.fn('Organization.rename')(function* (companyId, kind, id, name, expectedVersion) {
          const unit = yield* find(companyId, kind, id)
          yield* checkVersion(unit.version, expectedVersion)
          if (isOrganizationNameTaken(name, yield* unitsOf(companyId, kind), unit.id)) {
            return yield* new OrganizationNameTaken({})
          }
          const next = { ...unit, name: name.trim(), version: unit.version + 1 }
          yield* units.save(next)
          return yield* view(next)
        }),
        remove: Effect.fn('Organization.remove')(function* (companyId, kind, id) {
          const unit = yield* find(companyId, kind, id)
          if ((yield* view(unit)).inUse) return yield* new OrganizationUnitInUse({ kind })
          yield* units.remove(companyId, id)
        }),
        reorder: Effect.fn('Organization.reorder')(function* (companyId, kind, ids) {
          const existing = yield* unitsOf(companyId, kind)
          const known = new Set(existing.map((unit) => unit.id as string))
          if (ids.length !== known.size || new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) {
            return yield* new OrganizationOrderMismatch({})
          }
          for (const unit of existing) {
            const order = ids.indexOf(unit.id)
            if (order !== unit.order) yield* units.save({ ...unit, order, version: unit.version + 1 })
          }
          return yield* unitsOf(companyId, kind).pipe(Effect.flatMap((all) => Effect.forEach(all, view)))
        }),
      })
    }),
  )
}
