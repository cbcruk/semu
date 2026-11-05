import { Context, Layer, Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { problemType } from '../../../shared/problem/problem.ts'
import { makeMemoryTable, type TenantTable } from '../shared/tenant-table.ts'

/** 조직 단위 종류입니다. */
export type OrganizationUnitKind = 'DEPARTMENT' | 'POSITION'

/** 부서 또는 직위 응답입니다. */
export const OrganizationUnit = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  /** 화면 표시 순서입니다. 0부터 시작합니다. */
  order: Schema.Int,
  /** 한 번이라도 직원에게 배정됐는지입니다. 참이면 지울 수 없습니다. */
  inUse: Schema.Boolean,
  version: Schema.Int,
})

/** 부서·직위 이름 본문입니다. */
export const OrganizationUnitName = Schema.Struct({ name: Schema.NonEmptyString })

/** 표시 순서 변경 본문입니다. 회사의 모든 단위 ID를 원하는 순서로 보냅니다. */
export const OrganizationOrder = Schema.Struct({ ids: Schema.Array(Schema.String) })

/** 저장하는 부서·직위입니다. */
export interface OrganizationUnitRecord {
  id: Id<'department'> | Id<'position'>
  companyId: Id<'company'>
  kind: OrganizationUnitKind
  name: string
  order: number
  everAssigned: boolean
  version: number
}

/** 부서·직위 저장소입니다. */
export class OrganizationRepository extends Context.Service<
  OrganizationRepository,
  TenantTable<OrganizationUnitRecord>
>()('semu/hr/OrganizationRepository') {
  /** `seed`로 시작해 프로세스 메모리에 부서·직위를 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<OrganizationUnitRecord> = []) =>
    Layer.effect(OrganizationRepository, makeMemoryTable(seed))
}

/** 부서·직위가 없습니다. */
export class OrganizationUnitNotFound extends HttpApiError.Problem<OrganizationUnitNotFound>()(
  'OrganizationUnitNotFound',
  { type: problemType('ORGANIZATION_UNIT_NOT_FOUND'), status: 404, title: 'Department or position not found' },
  { code: Schema.tag('ORGANIZATION_UNIT_NOT_FOUND') },
) {}

/** 같은 이름의 부서·직위가 이미 있습니다. */
export class OrganizationNameTaken extends HttpApiError.Problem<OrganizationNameTaken>()(
  'OrganizationNameTaken',
  { type: problemType('ORGANIZATION_NAME_TAKEN'), status: 409, title: 'Name is already used' },
  { code: Schema.tag('ORGANIZATION_NAME_TAKEN') },
) {}

/** 한 번이라도 배정된 부서·직위는 지울 수 없습니다. */
export class OrganizationUnitInUse extends HttpApiError.Problem<OrganizationUnitInUse>()(
  'OrganizationUnitInUse',
  { type: problemType('ORGANIZATION_UNIT_IN_USE'), status: 409, title: 'Department or position was assigned' },
  { code: Schema.tag('ORGANIZATION_UNIT_IN_USE'), kind: Schema.Literals(['DEPARTMENT', 'POSITION']) },
) {}

/** 순서 변경 목록이 회사의 단위와 맞지 않습니다. */
export class OrganizationOrderMismatch extends HttpApiError.Problem<OrganizationOrderMismatch>()(
  'OrganizationOrderMismatch',
  { type: problemType('ORGANIZATION_ORDER_MISMATCH'), status: 422, title: 'Order must list every unit once' },
  { code: Schema.tag('ORGANIZATION_ORDER_MISMATCH') },
) {}
