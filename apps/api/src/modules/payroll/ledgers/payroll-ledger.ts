import { Schema } from 'effect'
import { IdSchema } from '../../../shared/ids/id-schema.ts'
import type { ActorKind } from '../../identity-access/actor.types.ts'
import { CalendarDate, YearMonthString } from '../payroll-schema.ts'
import { EmployeeSnapshotSchema, PayrollRowInputSchema, PayrollRowResultSchema } from '../rows/payroll-row-input.ts'
import { paymentMonthOf } from './ledger-rules.ts'
import { allowedActions, stepOf } from './ledger-status.ts'
import type { PayrollLedgerRecord, PayrollRowRecord } from './payroll-ledger.types.ts'

const LedgerStatusSchema = Schema.Literals(['DRAFT', 'SUBMITTED', 'PENDING_APPROVAL', 'CLOSED'])

const LedgerActionSchema = Schema.Literals([
  'SUBMIT',
  'RETURN_TO_DRAFT',
  'REQUEST_APPROVAL',
  'WITHDRAW_APPROVAL_REQUEST',
  'APPROVE',
  'REJECT',
  'CLOSE',
  'REOPEN',
  'EDIT_ROWS',
  'RECALCULATE',
  'DELETE',
])

/** 행의 소득자 사본입니다. 직원이 연결된 행은 HR 값, 소득자 명부를 가리키는 행은 명부 값입니다. */
export const PayrollEarnerSchema = Schema.Struct({
  email: Schema.NullOr(Schema.String),
  registrationNumberMasked: Schema.NullOr(Schema.String),
  departmentName: Schema.NullOr(Schema.String),
})

/** 급여대장 응답입니다. 행은 `GET /payroll-ledgers/{ledgerId}/rows`로 읽습니다. */
export const PayrollLedger = Schema.Struct({
  id: IdSchema('payrollLedger'),
  kind: Schema.Literals(['REGULAR', 'ADDITIONAL']),
  workflow: Schema.Literals(['CLIENT_APPROVAL', 'DIRECT_CLOSE']),
  status: LedgerStatusSchema,
  /** 목록 화면의 `n/3` 진행 단계입니다. */
  step: Schema.Literals([1, 2, 3]),
  title: Schema.String,
  attributionMonth: Schema.String,
  paymentDate: Schema.String,
  paymentMonth: Schema.String,
  wagePeriod: Schema.Struct({ start: Schema.String, end: Schema.String }),
  rowCount: Schema.Int,
  totals: Schema.Struct({
    grossPay: Schema.Int,
    deductionTotal: Schema.Int,
    netPay: Schema.Int,
    incomeTax: Schema.Int,
    localIncomeTax: Schema.Int,
    employerInsurance: Schema.Int,
  }),
  rejection: Schema.NullOr(Schema.Struct({ reason: Schema.String, rejectedAt: Schema.String })),
  reopenReason: Schema.NullOr(Schema.String),
  /** 지급월 원천세 신고가 끝나 금액이 바뀌는 동작이 잠겼는지입니다. */
  withholdingFiled: Schema.Boolean,
  allowedActions: Schema.Array(LedgerActionSchema),
  warnings: Schema.Array(
    Schema.Struct({ code: Schema.String, message: Schema.String, rowId: Schema.optionalKey(Schema.String) }),
  ),
  calculatedAt: Schema.NullOr(Schema.String),
  closedAt: Schema.NullOr(Schema.String),
  version: Schema.Int,
  createdAt: Schema.String,
  updatedAt: Schema.String,
})

/** 급여대장 행 응답입니다. */
export const PayrollRow = Schema.Struct({
  id: IdSchema('payrollRow'),
  ledgerId: IdSchema('payrollLedger'),
  employeeId: Schema.NullOr(IdSchema('employee')),
  earnerId: Schema.NullOr(IdSchema('earner')),
  payeeName: Schema.String,
  earner: PayrollEarnerSchema,
  incomeType: Schema.String,
  input: PayrollRowInputSchema,
  snapshot: Schema.NullOr(EmployeeSnapshotSchema),
  result: Schema.NullOr(PayrollRowResultSchema),
  updatedAt: Schema.String,
})

/** `POST /payroll-ledgers` 본문입니다. 귀속월의 첫 대장이면 정기, 아니면 추가 대장입니다. */
export const CreatePayrollLedger = Schema.Struct({
  attributionMonth: YearMonthString,
  /** 없으면 급여 설정의 지급월·지급일로 정합니다. 추가 대장은 정기 대장의 지급일입니다. */
  paymentDate: Schema.optionalKey(CalendarDate),
  title: Schema.optionalKey(Schema.String.pipe(Schema.check(Schema.isMinLength(1)))),
})

/** `PATCH /payroll-ledgers/{ledgerId}` 본문입니다. */
export const UpdatePayrollLedger = Schema.Struct({
  paymentDate: Schema.optionalKey(CalendarDate),
  title: Schema.optionalKey(Schema.String.pipe(Schema.check(Schema.isMinLength(1)))),
})

/**
 * `POST /payroll-ledgers/{ledgerId}/rows` 본문입니다. 근로 행은 `employeeId`, 그 밖의 행은 `employeeId`나 소득자 명부의
 * `earnerId` 중 하나가 필요합니다. 이름과 소득자 사본(`earner`)은 직원이나 명부에서 복사하므로 받지 않습니다.
 */
export const AddPayrollRow = Schema.Struct({
  employeeId: Schema.optionalKey(IdSchema('employee')),
  earnerId: Schema.optionalKey(IdSchema('earner')),
  input: PayrollRowInputSchema,
})

/**
 * `PATCH /payroll-ledgers/{ledgerId}/rows/{rowId}` 본문입니다. 계산 입력만 바꿉니다. 소득 구분과 소득자는 바꿀 수 없어,
 * 소득자를 바꾸려면 행을 지우고 다시 넣습니다.
 */
export const UpdatePayrollRow = Schema.Struct({
  input: PayrollRowInputSchema,
})

/** 반려·마감 해제처럼 사유가 필요한 커맨드 본문입니다. */
export const ReasonBody = Schema.Struct({ reason: Schema.String.pipe(Schema.check(Schema.isMinLength(1))) })

/** 대장 레코드를 행위자 기준 응답으로 바꿉니다. */
export function ledgerResponse(
  ledger: PayrollLedgerRecord,
  actor: ActorKind,
  withholdingFiled: boolean,
): typeof PayrollLedger.Type {
  const results = ledger.rows.flatMap((row) => (row.result === null ? [] : [row.result]))
  const total = (pick: (result: (typeof results)[number]) => number) =>
    results.reduce((sum, result) => sum + pick(result), 0)
  return {
    id: ledger.id,
    kind: ledger.kind,
    workflow: ledger.workflow,
    status: ledger.status,
    step: stepOf(ledger.status),
    title: ledger.title,
    attributionMonth: ledger.attributionMonth,
    paymentDate: ledger.paymentDate,
    paymentMonth: paymentMonthOf(ledger.paymentDate),
    wagePeriod: ledger.wagePeriod,
    rowCount: ledger.rows.length,
    totals: {
      grossPay: total((result) => result.grossPay),
      deductionTotal: total((result) => result.deductionTotal),
      netPay: total((result) => result.netPay),
      incomeTax: total((result) => result.incomeTax),
      localIncomeTax: total((result) => result.localIncomeTax),
      employerInsurance: total((result) => result.employerInsurance.total),
    },
    rejection: ledger.rejection,
    reopenReason: ledger.reopenReason,
    withholdingFiled,
    allowedActions: allowedActions({ status: ledger.status, workflow: ledger.workflow, actor, withholdingFiled }),
    warnings: ledger.rows.flatMap((row) =>
      (row.result?.warnings ?? []).map((warning) => ({ code: warning.code, message: warning.message, rowId: row.id })),
    ),
    calculatedAt: ledger.calculatedAt,
    closedAt: ledger.closedAt,
    version: ledger.version,
    createdAt: ledger.createdAt,
    updatedAt: ledger.updatedAt,
  }
}

/** 행 레코드를 응답으로 바꿉니다. */
export function rowResponse(ledger: PayrollLedgerRecord, row: PayrollRowRecord): typeof PayrollRow.Type {
  return {
    id: row.id,
    ledgerId: ledger.id,
    employeeId: row.employeeId,
    earnerId: row.earnerId,
    payeeName: row.payeeName,
    earner: row.earner,
    incomeType: row.input.incomeType,
    input: row.input,
    snapshot: row.snapshot,
    result: row.result,
    updatedAt: row.updatedAt,
  }
}
