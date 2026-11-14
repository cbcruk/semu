import { Result } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { isOrganizationNameTaken, isOrganizationUnitInUse } from './organization-rules.ts'
import {
  OrganizationNameTaken,
  OrganizationOrderMismatch,
  OrganizationUnitInUse,
  type OrganizationUnitKind,
  type OrganizationUnitRecord,
} from './organization.ts'

/**
 * 조직 단위(부서·직위) 애그리거트입니다(docs/design/domain-model.md). 생성·이름 변경·삭제·순서 변경의 판정 함수(`decide…`)와,
 * 직원 배치 묶음에서 직원 판정이 부르는 {@link unitsMarkedAssigned}를 둡니다.
 *
 * 판정 함수는 순수 함수입니다. 같은 종류의 단위 목록과 지금 배치된 직원 수는 서비스가 읽어 인자로 넘깁니다(회사 범위 불변식, M3).
 * 버전 검사(`If-Match`)는 서비스가 맡습니다. 조직 단위 변경은 이벤트를 내지 않습니다.
 */

/** 판정 결과입니다. */
export interface OrganizationUnitDecision {
  unit: OrganizationUnitRecord
}

/** 만들 단위입니다. ID는 서비스가 정합니다. */
export interface OrganizationUnitCreation {
  id: Id<'department'> | Id<'position'>
  companyId: Id<'company'>
  kind: OrganizationUnitKind
  name: string
}

/** 단위 생성을 판정합니다. 같은 종류 안에서 이름이 겹치면 거부하고, 순서는 맨 뒤입니다. */
export function decideUnitCreation(
  input: OrganizationUnitCreation,
  siblings: ReadonlyArray<OrganizationUnitRecord>,
): Result.Result<OrganizationUnitDecision, OrganizationNameTaken> {
  if (isOrganizationNameTaken(input.name, siblings)) return Result.fail(new OrganizationNameTaken({}))
  return Result.succeed({
    unit: {
      id: input.id,
      companyId: input.companyId,
      kind: input.kind,
      name: input.name.trim(),
      order: siblings.length,
      everAssigned: false,
      version: 1,
    },
  })
}

/** 이름 변경을 판정합니다. 자기 자신을 뺀 같은 종류 안에서 이름이 겹치면 거부합니다. */
export function decideUnitRename(
  unit: OrganizationUnitRecord,
  name: string,
  siblings: ReadonlyArray<OrganizationUnitRecord>,
): Result.Result<OrganizationUnitDecision, OrganizationNameTaken> {
  if (isOrganizationNameTaken(name, siblings, unit.id)) return Result.fail(new OrganizationNameTaken({}))
  return Result.succeed({ unit: { ...unit, name: name.trim(), version: unit.version + 1 } })
}

/** 삭제를 판정합니다. 한 번이라도 배치됐거나 지금 배치된 직원이 있으면 거부합니다. */
export function decideUnitRemoval(
  unit: OrganizationUnitRecord,
  assignedEmployeeCount: number,
): Result.Result<void, OrganizationUnitInUse> {
  return isOrganizationUnitInUse({ everAssigned: unit.everAssigned, assignedEmployeeCount })
    ? Result.fail(new OrganizationUnitInUse({ kind: unit.kind }))
    : Result.void
}

/**
 * 순서 변경을 판정합니다. `ids`는 같은 종류의 모든 단위를 한 번씩 담아야 합니다. 결과는 순서가 바뀌어 저장할 단위만입니다.
 */
export function decideUnitReorder(
  siblings: ReadonlyArray<OrganizationUnitRecord>,
  ids: ReadonlyArray<string>,
): Result.Result<{ units: OrganizationUnitRecord[] }, OrganizationOrderMismatch> {
  const known = new Set(siblings.map((unit) => unit.id as string))
  if (ids.length !== known.size || new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) {
    return Result.fail(new OrganizationOrderMismatch({}))
  }
  const units = siblings.flatMap((unit) => {
    const order = ids.indexOf(unit.id)
    return order === unit.order ? [] : [{ ...unit, order, version: unit.version + 1 }]
  })
  return Result.succeed({ units })
}

/** 직원이 가리키는 부서·직위입니다. */
export interface UnitPlacement {
  departmentId?: Id<'department'> | undefined
  positionId?: Id<'position'> | undefined
}

/**
 * 직원 배치 묶음(Employee + OrganizationUnit)입니다. 직원이 가리키는 단위 중 아직 배치 표시가 없는 것을 켜서 돌려줍니다.
 * 표시는 한 번 켜면 끄지 않는 저장값이라 직원과 같은 트랜잭션에 저장해야 합니다. 버전은 올리지 않습니다(사용자 편집이 아님).
 */
export function unitsMarkedAssigned(
  placement: UnitPlacement,
  units: ReadonlyArray<OrganizationUnitRecord>,
): OrganizationUnitRecord[] {
  const ids = [placement.departmentId, placement.positionId].filter((id) => id !== undefined)
  return units
    .filter((unit) => ids.includes(unit.id) && !unit.everAssigned)
    .map((unit) => ({ ...unit, everAssigned: true }))
}
