import type { DependantCounts, FamilyRelation, YearEndDependantType } from './family-member.types.ts'

/** 비과세 보육수당 대상 자녀의 최대 나이(과세기간 개시일 현재 6세)입니다. 소득세법 제12조제3호머목2)입니다. */
export const TAX_FREE_CHILD_MAX_AGE = 6

/**
 * 간이세액표에 쓰는 공제대상 가족 수입니다(현행 R21).
 *
 * 연말정산 대상으로 표시했고 `asOf`까지 태어난 가족에 본인 1명을 더합니다. 8–20세 자녀는 관계가 자녀이고
 * `asOf`의 연도 − 출생 연도가 8 이상 20 이하인 사람입니다(간이세액표가 연 나이로 셉니다).
 *
 * 공제 구분이 나이 기준(`AGE_20_OR_UNDER`·`AGE_60_OR_OVER`)인데 `asOf`의 연도에 그 나이가 아니면 세지 않습니다.
 * 소득세법 제50조①3호가 20세 이하·60세 이상을 정하고, 같은 조 ③이 과세기간 중 그 나이에 해당하는 날이 있으면 대상으로
 * 보므로 연도 − 출생 연도로 봅니다. 해가 바뀌어 20세를 넘긴 자녀가 다시 저장하지 않아도 빠집니다.
 */
export function countDependants(
  members: ReadonlyArray<{
    relation: FamilyRelation
    birthDate: string
    yearEndTarget: boolean
    yearEndDependantType?: YearEndDependantType | undefined
  }>,
  asOf: string,
): DependantCounts {
  const 기준연도 = Number(asOf.slice(0, 4))
  const 공제대상가족 = members.filter(
    (member) =>
      member.yearEndTarget &&
      member.birthDate <= asOf &&
      fitsAgeBasedType(member.yearEndDependantType, 기준연도 - Number(member.birthDate.slice(0, 4))),
  )
  const 자녀8세이상20세이하 = 공제대상가족.filter((member) => {
    const 연나이 = 기준연도 - Number(member.birthDate.slice(0, 4))
    return member.relation === 'CHILD' && 연나이 >= 8 && 연나이 <= 20
  })
  return { dependantsCount: 1 + 공제대상가족.length, childrenAged8To20Count: 자녀8세이상20세이하.length }
}

/** 기본공제 나이 기준 구분이 연 나이(연도 − 출생 연도)와 맞는지입니다. 나이 기준이 아닌 구분은 언제나 맞습니다. */
export function fitsAgeBasedType(type: YearEndDependantType | undefined, yearAge: number): boolean {
  if (type === 'AGE_20_OR_UNDER') return yearAge <= 20
  if (type === 'AGE_60_OR_OVER') return yearAge >= 60
  return true
}

/**
 * 비과세 보육수당 대상이 될 수 있는지입니다. 자녀 중 `asOf`가 속한 과세기간 개시일(1월 1일) 현재 6세 이하인
 * 사람만 됩니다. 법은 "근로자 또는 그 배우자의 … 자녀"라 손자녀는 대상이 아닙니다.
 *
 * 소득세법 제12조제3호머목2)는 6세 이하를 "6세가 되는 날과 그 이전 기간"으로 정의합니다. 1월 1일 현재 6세 생일이
 * 지나지 않았거나 그날이 6세 생일이면 대상이라, `asOf`의 연도 − 출생 연도가 6 이하인지와 같습니다. 그해 중 6세가
 * 되면 그 과세기간 내내 대상이고, 전년에 이미 6세가 됐으면 `asOf`에 만 6세여도 대상이 아닙니다. `asOf`에 아직
 * 태어나지 않았으면 대상이 아닙니다.
 */
export function canBeTaxFreeTarget(member: { relation: FamilyRelation; birthDate: string }, asOf: string): boolean {
  const 자녀인가 = member.relation === 'CHILD'
  const 연나이 = Number(asOf.slice(0, 4)) - Number(member.birthDate.slice(0, 4))
  return 자녀인가 && member.birthDate <= asOf && 연나이 <= TAX_FREE_CHILD_MAX_AGE
}
