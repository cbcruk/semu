import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { Page, PageQueryFields } from '../../../shared/http/pagination.ts'
import { IdSchema } from '../../../shared/ids/id-schema.ts'
import { VersionMismatch } from '../../../shared/problem/problem.ts'
import { Authentication } from '../../identity-access/authentication.ts'
import {
  ACCESS_ERRORS,
  AdditionalLedgerBlocked,
  EmployeeNotFound,
  PayrollLedgerHasAdditional,
  PayrollLedgerNotFound,
  PayrollLedgerReadOnly,
  PayrollLedgerTransitionInvalid,
  PayrollRowNotFound,
  PayrollRowPayeeInvalid,
  RateTableNotFound,
  WageIncomeDuplicated,
  WageRowOnAdditionalLedger,
  WithholdingFiled,
} from '../payroll-problems.ts'
import { YearMonthString } from '../payroll-schema.ts'
import {
  AddPayrollRow,
  CreatePayrollLedger,
  PayrollLedger,
  PayrollRow,
  ReasonBody,
  UpdatePayrollLedger,
  UpdatePayrollRow,
} from './payroll-ledger.ts'

const READ_ERRORS = [...ACCESS_ERRORS, PayrollLedgerNotFound] as const

const WRITE_ERRORS = [
  ...READ_ERRORS,
  VersionMismatch,
  PayrollRowNotFound,
  PayrollLedgerTransitionInvalid,
  PayrollLedgerReadOnly,
  WithholdingFiled,
  AdditionalLedgerBlocked,
  WageRowOnAdditionalLedger,
  WageIncomeDuplicated,
  PayrollLedgerHasAdditional,
  PayrollRowPayeeInvalid,
  EmployeeNotFound,
  RateTableNotFound,
] as const

const ledgerParams = { ledgerId: IdSchema('payrollLedger') }
const rowParams = { ledgerId: IdSchema('payrollLedger'), rowId: IdSchema('payrollRow') }
const ifMatch = { 'if-match': Schema.optionalKey(Schema.String) }
const LedgerWithEtag = HttpApiSchema.WithHeaders(PayrollLedger, { etag: Schema.String })
const RowWithEtag = HttpApiSchema.WithHeaders(PayrollRow, { etag: Schema.String })

function command<const Name extends string, const Path extends `/payroll-ledgers/:ledgerId::${string}`>(
  name: Name,
  path: Path,
) {
  return HttpApiEndpoint.post(name, path, {
    params: ledgerParams,
    headers: ifMatch,
    success: LedgerWithEtag,
    error: WRITE_ERRORS,
  })
}

function reasonCommand<const Name extends string, const Path extends `/payroll-ledgers/:ledgerId::${string}`>(
  name: Name,
  path: Path,
) {
  return HttpApiEndpoint.post(name, path, {
    params: ledgerParams,
    headers: ifMatch,
    payload: ReasonBody,
    success: LedgerWithEtag,
    error: WRITE_ERRORS,
  })
}

/**
 * 급여대장(현행 급여카드)과 그 행입니다. 상태는 커맨드로만 바뀌고, 행 쓰기는 대장 `version`을 올립니다.
 * 행 응답의 `ETag`는 대장의 버전입니다.
 */
export class PayrollLedgersGroup extends HttpApiGroup.make('payroll-ledgers')
  .add(
    HttpApiEndpoint.get('list', '/payroll-ledgers', {
      query: {
        ...PageQueryFields,
        attributionMonth: Schema.optionalKey(YearMonthString),
        paymentMonth: Schema.optionalKey(YearMonthString),
        status: Schema.optionalKey(Schema.Literals(['DRAFT', 'SUBMITTED', 'PENDING_APPROVAL', 'CLOSED'])),
      },
      success: Page(PayrollLedger),
      error: ACCESS_ERRORS,
    }),
  )
  .add(
    HttpApiEndpoint.post('create', '/payroll-ledgers', {
      payload: CreatePayrollLedger,
      success: HttpApiSchema.WithHeaders(PayrollLedger, { etag: Schema.String }).pipe(HttpApiSchema.status(201)),
      error: WRITE_ERRORS,
    }),
  )
  .add(
    HttpApiEndpoint.get('get', '/payroll-ledgers/:ledgerId', {
      params: ledgerParams,
      success: LedgerWithEtag,
      error: READ_ERRORS,
    }),
  )
  .add(
    HttpApiEndpoint.patch('update', '/payroll-ledgers/:ledgerId', {
      params: ledgerParams,
      headers: ifMatch,
      payload: UpdatePayrollLedger,
      success: LedgerWithEtag,
      error: WRITE_ERRORS,
    }),
  )
  .add(
    HttpApiEndpoint.delete('delete', '/payroll-ledgers/:ledgerId', {
      params: ledgerParams,
      headers: ifMatch,
      error: WRITE_ERRORS,
    }),
  )
  .add(
    HttpApiEndpoint.get('listRows', '/payroll-ledgers/:ledgerId/rows', {
      params: ledgerParams,
      success: Schema.Struct({ items: Schema.Array(PayrollRow) }),
      error: READ_ERRORS,
    }),
  )
  .add(
    HttpApiEndpoint.post('addRow', '/payroll-ledgers/:ledgerId/rows', {
      params: ledgerParams,
      headers: ifMatch,
      payload: AddPayrollRow,
      success: HttpApiSchema.WithHeaders(PayrollRow, { etag: Schema.String }).pipe(HttpApiSchema.status(201)),
      error: WRITE_ERRORS,
    }),
  )
  .add(
    HttpApiEndpoint.patch('updateRow', '/payroll-ledgers/:ledgerId/rows/:rowId', {
      params: rowParams,
      headers: ifMatch,
      payload: UpdatePayrollRow,
      success: RowWithEtag,
      error: WRITE_ERRORS,
    }),
  )
  .add(
    HttpApiEndpoint.delete('deleteRow', '/payroll-ledgers/:ledgerId/rows/:rowId', {
      params: rowParams,
      headers: ifMatch,
      error: WRITE_ERRORS,
    }),
  )
  .add(command('recalculate', '/payroll-ledgers/:ledgerId::recalculate'))
  .add(command('submit', '/payroll-ledgers/:ledgerId::submit'))
  .add(command('returnToDraft', '/payroll-ledgers/:ledgerId::return-to-draft'))
  .add(command('requestApproval', '/payroll-ledgers/:ledgerId::request-approval'))
  .add(command('withdrawApprovalRequest', '/payroll-ledgers/:ledgerId::withdraw-approval-request'))
  .add(command('close', '/payroll-ledgers/:ledgerId::close'))
  .add(reasonCommand('reopen', '/payroll-ledgers/:ledgerId::reopen'))
  .middleware(Authentication) {}

/** 고객의 급여대장 결재입니다. `payroll-ledger:approve` 권한이 있는 고객 사용자만 씁니다. */
export class PayrollLedgerApprovalsGroup extends HttpApiGroup.make('payroll-ledger-approvals')
  .add(command('approve', '/payroll-ledgers/:ledgerId::approve'))
  .add(reasonCommand('reject', '/payroll-ledgers/:ledgerId::reject'))
  .middleware(Authentication) {}
