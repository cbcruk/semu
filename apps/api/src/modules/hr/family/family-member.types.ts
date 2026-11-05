/** 근로자와의 관계입니다. 현행 한글 enum(`부모`, `(시/처)조부모`, `사위_자부` …)을 바꿨습니다. */
export type FamilyRelation =
  | 'PARENT'
  | 'GRANDPARENT'
  | 'SPOUSE_GRANDPARENT'
  | 'GREAT_GRANDPARENT'
  | 'SPOUSE_GREAT_GRANDPARENT'
  | 'WIFE_PARENT'
  | 'HUSBAND_PARENT'
  | 'SPOUSE'
  | 'CHILD'
  | 'CHILD_IN_LAW'
  | 'GRANDCHILD'
  | 'GREAT_GRANDCHILD'
  | 'SIBLING'
  | 'OTHER'
  | 'NONE'

/** 연말정산 기본공제 구분입니다. */
export type YearEndDependantType =
  'NOT_ELIGIBLE' | 'SPOUSE' | 'AGE_20_OR_UNDER' | 'AGE_60_OR_OVER' | 'DISABLED' | 'BASIC_LIVELIHOOD' | 'CHILD_INCENTIVE'

/** 간이세액표에 쓰는 공제대상 가족 수입니다. */
export interface DependantCounts {
  /** 본인을 포함한 공제대상 가족 수입니다. */
  dependantsCount: number
  /** 그중 8–20세 자녀 수입니다. */
  childrenAged8To20Count: number
}
