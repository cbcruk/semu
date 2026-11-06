import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { IdSchema } from '../../../shared/ids/id-schema.ts'
import {
  IdempotencyKeyInProgress,
  IdempotencyKeyRequired,
  IdempotencyKeyReused,
} from '../../../shared/problem/problem.ts'
import { Authentication } from '../../identity-access/authentication.ts'
import { ACCESS_ERRORS, PayslipNotFound, PayslipSendInterrupted } from '../payroll-problems.ts'
import { YearMonthString } from '../payroll-schema.ts'
import { Payslip, PayslipSendJob, SendPayslips } from './payslip.ts'

/** 급여·사업·기타소득 명세서와 메일 발송입니다. 발송은 대장 상태를 바꾸지 않습니다. */
export class PayslipsGroup extends HttpApiGroup.make('payslips')
  .add(
    HttpApiEndpoint.get('list', '/payslips', {
      query: {
        ledgerId: Schema.optionalKey(IdSchema('payrollLedger')),
        paymentMonth: Schema.optionalKey(YearMonthString),
      },
      success: Schema.Struct({ items: Schema.Array(Payslip) }),
      error: ACCESS_ERRORS,
    }),
  )
  .add(
    HttpApiEndpoint.get('get', '/payslips/:payslipId', {
      params: { payslipId: IdSchema('payslip') },
      success: Payslip,
      error: [...ACCESS_ERRORS, PayslipNotFound],
    }),
  )
  .add(
    HttpApiEndpoint.post('send', '/payslips::send', {
      headers: { 'idempotency-key': Schema.optionalKey(Schema.String) },
      payload: SendPayslips,
      success: PayslipSendJob.pipe(HttpApiSchema.status(202)),
      error: [
        ...ACCESS_ERRORS,
        PayslipNotFound,
        IdempotencyKeyRequired,
        IdempotencyKeyReused,
        IdempotencyKeyInProgress,
        PayslipSendInterrupted,
      ],
    }),
  )
  .middleware(Authentication) {}
