import type { Id } from '../../../shared/ids/ids.types.ts'

/** 문서 보관함 카테고리입니다. */
export type EmployeeDocumentCategory = 'CONTRACT' | 'CERTIFICATE' | 'CONSENT' | 'RESIGNATION' | 'OTHER'

/** 서명 문서가 이어진 인사 기록입니다. */
export type EmployeeDocumentLink =
  { type: 'WORK_CONTRACT'; id: Id<'workContract'> } | { type: 'PAYROLL_CONTRACT'; id: Id<'payrollContract'> }

/** 서명 완료 요청에 든 문서 하나입니다. 종류 이름은 Documents의 템플릿 종류입니다. */
export interface SignedDocumentPart {
  kind: string
  title: string
  terms: {
    /** 근로계약서의 근로개시일입니다. */
    startDate?: string
    /** 연봉계약서의 적용 시작일입니다. */
    effectiveDate?: string
    /** 연봉계약서의 연봉(원)입니다. */
    annualSalary?: number
  }
}

/** 서명 문서를 이을 수 있는 계약들입니다. */
export interface LinkCandidates {
  /** 직원의 입사일입니다. 근로개시일을 비워 둔 근로계약서는 입사일로 맞춥니다. */
  joinDate: string
  workContracts: ReadonlyArray<{ id: Id<'workContract'>; startDate: string; createdAt: string }>
  payrollContracts: ReadonlyArray<{
    id: Id<'payrollContract'>
    startDate: string
    annualSalary?: number | undefined
    createdAt: string
  }>
}
