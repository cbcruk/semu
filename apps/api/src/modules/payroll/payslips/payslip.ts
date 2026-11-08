import { Schema } from 'effect'
import { IdSchema } from '../../../shared/ids/id-schema.ts'
import { PayrollEarnerSchema } from '../ledgers/payroll-ledger.ts'

const Line = Schema.Struct({ code: Schema.String, name: Schema.String, amount: Schema.Int })

/** 명세서 응답입니다. 마감된 대장 행 하나의 지급·공제 내역과 발송 상태입니다. */
export const Payslip = Schema.Struct({
  id: IdSchema('payslip'),
  ledgerId: IdSchema('payrollLedger'),
  rowId: IdSchema('payrollRow'),
  employeeId: Schema.NullOr(IdSchema('employee')),
  payeeName: Schema.String,
  /** 마감한 대장 행의 소득자 사본입니다. 발송은 `earner.email`로 합니다. */
  earner: PayrollEarnerSchema,
  incomeType: Schema.String,
  attributionMonth: Schema.String,
  paymentDate: Schema.String,
  payments: Schema.Array(Line),
  deductions: Schema.Array(Line),
  grossPay: Schema.Int,
  deductionTotal: Schema.Int,
  netPay: Schema.Int,
  /** 마지막 발송 결과입니다. 보낸 적 없으면 `NOT_SENT`입니다. */
  delivery: Schema.Struct({
    status: Schema.Literals(['NOT_SENT', 'SENT', 'FAILED']),
    failureReason: Schema.NullOr(Schema.Literals(['NO_EMAIL', 'REJECTED'])),
    attemptedAt: Schema.NullOr(Schema.String),
    attempts: Schema.Int,
  }),
})

/** `POST /payslips:send` 본문입니다. */
export const SendPayslips = Schema.Struct({
  payslipIds: Schema.Array(IdSchema('payslip')).pipe(Schema.check(Schema.isMinLength(1))),
})

/** 명세서 발송 작업입니다. 메일 연동이 동기 가짜라 응답할 때 이미 끝나 있습니다. */
export const PayslipSendJob = Schema.Struct({
  id: IdSchema('job'),
  status: Schema.Literals(['SUCCEEDED', 'PARTIALLY_SUCCEEDED', 'FAILED']),
  result: Schema.Struct({
    items: Schema.Array(
      Schema.Struct({
        payslipId: IdSchema('payslip'),
        status: Schema.Literals(['SENT', 'FAILED']),
        failureReason: Schema.NullOr(Schema.Literals(['NO_EMAIL', 'REJECTED'])),
      }),
    ),
  }),
  createdAt: Schema.String,
  finishedAt: Schema.String,
})
