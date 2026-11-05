import { ageOn } from '../../../shared/time/calendar.ts'
import type { DependantCounts, FamilyRelation } from './family-member.types.ts'

/** 비과세 육아수당 대상 자녀의 최대 나이(만 6세)입니다. */
export const TAX_FREE_CHILD_MAX_AGE = 6

/**
 * 간이세액표에 쓰는 공제대상 가족 수입니다(현행 R21).
 *
 * 연말정산 대상으로 표시했고 `asOf`까지 태어난 가족에 본인 1명을 더합니다. 8–20세 자녀는 관계가 자녀이고
 * `asOf`의 연도 − 출생 연도가 8 이상 20 이하인 사람입니다(간이세액표가 연 나이로 셉니다).
 */
export function countDependants(
  members: ReadonlyArray<{ relation: FamilyRelation; birthDate: string; yearEndTarget: boolean }>,
  asOf: string,
): DependantCounts {
  const year = Number(asOf.slice(0, 4))
  const targets = members.filter((member) => member.yearEndTarget && member.birthDate <= asOf)
  const children = targets.filter((member) => {
    const age = year - Number(member.birthDate.slice(0, 4))
    return member.relation === 'CHILD' && age >= 8 && age <= 20
  })
  return { dependantsCount: 1 + targets.length, childrenAged8To20Count: children.length }
}

/** 비과세 육아수당 대상이 될 수 있는지입니다. 만 6세 이하 자녀·손자녀만 됩니다. */
export function canBeTaxFreeTarget(member: { relation: FamilyRelation; birthDate: string }, asOf: string): boolean {
  const isChild = member.relation === 'CHILD' || member.relation === 'GRANDCHILD'
  return isChild && ageOn(member.birthDate, asOf) <= TAX_FREE_CHILD_MAX_AGE
}
