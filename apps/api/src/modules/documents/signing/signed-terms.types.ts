import type { DocumentKind as DocumentKindSchema } from '../templates/esign-template.ts'

/** 템플릿이 만드는 문서 종류입니다. */
export type DocumentKind = typeof DocumentKindSchema.Type

/** 서명 완료 문서에서 뽑은 계약 조건입니다. 문서 종류에 따라 일부만 있습니다. */
export interface SignedTerms {
  /** 근로계약서의 근로개시일입니다. */
  startDate?: string
  /** 연봉계약서의 적용 시작일입니다. */
  effectiveDate?: string
  /** 연봉계약서의 연봉(원)입니다. */
  annualSalary?: number
}
