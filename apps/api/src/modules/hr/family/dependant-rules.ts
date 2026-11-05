import type { DependantCounts, FamilyRelation } from './family-member.types.ts'

/** 비과세 보육수당 대상 자녀의 최대 나이(과세기간 개시일 현재 6세)입니다. 소득세법 제12조제3호머목2)입니다. */
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

/**
 * 비과세 보육수당 대상이 될 수 있는지입니다. 자녀·손자녀 중 `asOf`가 속한 과세기간 개시일(1월 1일) 현재 6세 이하인
 * 사람만 됩니다.
 *
 * 소득세법 제12조제3호머목2)는 6세 이하를 "6세가 되는 날과 그 이전 기간"으로 정의합니다. 1월 1일 현재 6세 생일이
 * 지나지 않았거나 그날이 6세 생일이면 대상이라, `asOf`의 연도 − 출생 연도가 6 이하인지와 같습니다. 그해 중 6세가
 * 되면 그 과세기간 내내 대상이고, 전년에 이미 6세가 됐으면 `asOf`에 만 6세여도 대상이 아닙니다. `asOf`에 아직
 * 태어나지 않았으면 대상이 아닙니다.
 */
export function canBeTaxFreeTarget(member: { relation: FamilyRelation; birthDate: string }, asOf: string): boolean {
  const isChild = member.relation === 'CHILD' || member.relation === 'GRANDCHILD'
  const ageByYear = Number(asOf.slice(0, 4)) - Number(member.birthDate.slice(0, 4))
  return isChild && member.birthDate <= asOf && ageByYear <= TAX_FREE_CHILD_MAX_AGE
}
