/** 사용 여부 판정에 쓰는 부서·직위입니다. */
export interface OrganizationUnitUsage {
  /** 직원에 한 번이라도 배정됐으면 켜지고 다시 꺼지지 않습니다. */
  everAssigned: boolean
  /** 지금 이 단위를 가리키는 직원 수입니다. */
  assignedEmployeeCount: number
}

/**
 * 부서·직위가 사용 중인지입니다(현행 R4). 한 번이라도 배정됐거나 지금 배정된 직원이 있으면 사용 중이고, 지울 수 없습니다.
 *
 * 매뉴얼: "한 번 설정하여 사용된 부서 및 직위는 삭제할 수 없습니다."
 */
export function isOrganizationUnitInUse(unit: OrganizationUnitUsage): boolean {
  return unit.everAssigned || unit.assignedEmployeeCount > 0
}

/** 이름을 비교할 형태입니다. 앞뒤 공백을 무시합니다. */
export function organizationNameKey(name: string): string {
  return name.trim()
}

/** 같은 회사에 같은 이름이 이미 있는지입니다. 자기 자신은 뺍니다. */
export function isOrganizationNameTaken(
  name: string,
  existing: ReadonlyArray<{ id: string; name: string }>,
  selfId?: string,
): boolean {
  const 비교할이름 = organizationNameKey(name)
  return existing.some((unit) => unit.id !== selfId && organizationNameKey(unit.name) === 비교할이름)
}
