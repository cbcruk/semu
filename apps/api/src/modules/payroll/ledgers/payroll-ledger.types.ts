import type { Id } from '../../../shared/ids/ids.types.ts'
import type { EmployeeSnapshot, PayrollRowInputValue, PayrollRowResultValue } from '../rows/payroll-row-input.ts'
import type { LedgerStatus, LedgerWorkflow } from './ledger-status.types.ts'

/** 급여대장 종류입니다. 귀속월의 첫 대장이 정기(`REGULAR`), 그 뒤는 추가(`ADDITIONAL`)입니다. */
export type LedgerKind = 'REGULAR' | 'ADDITIONAL'

/**
 * 행에 둔 소득자 사본입니다. 명세서 머리와 발송 주소가 이 값을 씁니다.
 *
 * 직원이 연결된 행은 행을 만들 때와 `:recalculate` 때 HR 값을 복사하고(입력은 받지 않음), 직원이 없는 행(일용·사업·기타)은
 * 행을 추가·수정할 때 입력받습니다. 마감된 대장의 사본은 바뀌지 않으므로, 명세서는 마감한 그대로의 주소로 갑니다.
 */
export interface PayrollEarner {
  /** 명세서를 받을 주소입니다. 없으면 발송이 `NO_EMAIL`로 실패합니다. */
  email: string | null
  /** `900101-1******` 형식입니다. 원문 주민등록번호는 급여가 받지도 저장하지도 않습니다. */
  registrationNumberMasked: string | null
  departmentName: string | null
}

/** 급여대장의 행입니다. 소득자 한 명의 한 달 지급입니다. */
export interface PayrollRowRecord {
  id: Id<'payrollRow'>
  /** 근로 행은 직원 ID가 있고, 일용·사업·기타 행은 없을 수 있습니다. */
  employeeId: Id<'employee'> | null
  payeeName: string
  /** 소득자 사본입니다. */
  earner: PayrollEarner
  input: PayrollRowInputValue
  /** 근로 행이 계산에 쓴 HR 정보입니다. 재계산할 때 다시 받습니다. */
  snapshot: EmployeeSnapshot | null
  result: PayrollRowResultValue | null
  updatedAt: string
}

/** 급여대장 애그리거트입니다. 행은 대장을 통해서만 바뀌고, 행이 바뀌면 대장 `version`이 오릅니다. */
export interface PayrollLedgerRecord {
  id: Id<'payrollLedger'>
  companyId: Id<'company'>
  kind: LedgerKind
  /** 만들 때의 회사 운영 방식입니다. 설정을 바꿔도 이미 만든 대장은 그대로입니다. */
  workflow: LedgerWorkflow
  status: LedgerStatus
  title: string
  attributionMonth: string
  paymentDate: string
  wagePeriod: { start: string; end: string }
  rows: PayrollRowRecord[]
  /** 마지막 반려입니다. 다시 승인 요청하면 지웁니다. */
  rejection: { reason: string; rejectedAt: string } | null
  /** 마지막 마감 해제 사유입니다. */
  reopenReason: string | null
  calculatedAt: string | null
  closedAt: string | null
  version: number
  createdAt: string
  updatedAt: string
}
