import { Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import {
  EntitlementRequired,
  PermissionDenied,
  problemType,
  TermsReagreementRequired,
} from '../../shared/problem/problem.ts'

/** 인가 실패 응답입니다. 회사 리소스 엔드포인트마다 `error`에 함께 선언합니다. */
export const ACCESS_ERRORS = [PermissionDenied, EntitlementRequired, TermsReagreementRequired] as const

/** 급여대장이 없거나 다른 회사의 것입니다. */
export class PayrollLedgerNotFound extends HttpApiError.Problem<PayrollLedgerNotFound>()(
  'PayrollLedgerNotFound',
  { type: problemType('PAYROLL_LEDGER_NOT_FOUND'), status: 404, title: 'Payroll ledger not found' },
  { code: Schema.tag('PAYROLL_LEDGER_NOT_FOUND') },
) {}

/** 급여대장 행이 없습니다. */
export class PayrollRowNotFound extends HttpApiError.Problem<PayrollRowNotFound>()(
  'PayrollRowNotFound',
  { type: problemType('PAYROLL_ROW_NOT_FOUND'), status: 404, title: 'Payroll row not found' },
  { code: Schema.tag('PAYROLL_ROW_NOT_FOUND') },
) {}

/** 지금 상태·행위자·운영 방식에서 할 수 없는 전이입니다. `allowedActions`를 다시 읽어야 합니다. */
export class PayrollLedgerTransitionInvalid extends HttpApiError.Problem<PayrollLedgerTransitionInvalid>()(
  'PayrollLedgerTransitionInvalid',
  { type: problemType('PAYROLL_LEDGER_TRANSITION_INVALID'), status: 409, title: 'Payroll ledger cannot do this now' },
  {
    code: Schema.tag('PAYROLL_LEDGER_TRANSITION_INVALID'),
    ledgerStatus: Schema.String,
    action: Schema.String,
  },
) {}

/** 지금 상태에서 행위자가 입력을 고칠 수 없습니다. */
export class PayrollLedgerReadOnly extends HttpApiError.Problem<PayrollLedgerReadOnly>()(
  'PayrollLedgerReadOnly',
  { type: problemType('PAYROLL_LEDGER_READ_ONLY'), status: 409, title: 'Payroll ledger is read-only now' },
  { code: Schema.tag('PAYROLL_LEDGER_READ_ONLY'), ledgerStatus: Schema.String },
) {}

/** 지급월의 원천세 신고가 끝나 금액이 바뀌는 변경을 할 수 없습니다. 신고를 정정하는 것이 먼저입니다. */
export class WithholdingFiled extends HttpApiError.Problem<WithholdingFiled>()(
  'WithholdingFiled',
  { type: problemType('WITHHOLDING_FILED'), status: 409, title: 'Withholding tax of the payment month is filed' },
  { code: Schema.tag('WITHHOLDING_FILED'), paymentMonth: Schema.String },
) {}

/** 추가 급여대장을 만들 수 없습니다. `reason`이 막은 규칙입니다. */
export class AdditionalLedgerBlocked extends HttpApiError.Problem<AdditionalLedgerBlocked>()(
  'AdditionalLedgerBlocked',
  {
    type: problemType('ADDITIONAL_LEDGER_BLOCKED'),
    status: 409,
    title: 'Additional payroll ledger is not allowed now',
  },
  {
    code: Schema.tag('ADDITIONAL_LEDGER_BLOCKED'),
    reason: Schema.Literals([
      'NO_REGULAR_LEDGER',
      'REGULAR_LEDGER_NOT_SUBMITTED',
      'DRAFT_LEDGER_EXISTS',
      'WITHHOLDING_FILED',
      'WITHHOLDING_DEADLINE_NEAR',
    ]),
  },
) {}

/** 추가 급여대장에는 근로소득 행을 넣을 수 없습니다. */
export class WageRowOnAdditionalLedger extends HttpApiError.Problem<WageRowOnAdditionalLedger>()(
  'WageRowOnAdditionalLedger',
  { type: problemType('WAGE_ROW_ON_ADDITIONAL_LEDGER'), status: 409, title: 'Additional ledgers take no wage rows' },
  { code: Schema.tag('WAGE_ROW_ON_ADDITIONAL_LEDGER') },
) {}

/** 같은 귀속월에 그 직원의 근로소득 행이 이미 있습니다. */
export class WageIncomeDuplicated extends HttpApiError.Problem<WageIncomeDuplicated>()(
  'WageIncomeDuplicated',
  { type: problemType('WAGE_INCOME_DUPLICATED'), status: 409, title: 'Employee already has wage income this month' },
  { code: Schema.tag('WAGE_INCOME_DUPLICATED'), ledgerId: Schema.String },
) {}

/** 행의 소득자 정보가 맞지 않습니다. 근로 행은 직원 ID, 그 밖의 행은 소득자 이름이 필요하고 소득 구분은 바꿀 수 없습니다. */
export class PayrollRowPayeeInvalid extends HttpApiError.Problem<PayrollRowPayeeInvalid>()(
  'PayrollRowPayeeInvalid',
  { type: problemType('PAYROLL_ROW_PAYEE_INVALID'), status: 422, title: 'Payroll row payee is invalid' },
  {
    code: Schema.tag('PAYROLL_ROW_PAYEE_INVALID'),
    reason: Schema.Literals(['EMPLOYEE_REQUIRED', 'PAYEE_NAME_REQUIRED', 'INCOME_TYPE_CHANGED']),
  },
) {}

/** 정기 대장에 추가 대장이 딸려 있어 지울 수 없습니다. */
export class PayrollLedgerHasAdditional extends HttpApiError.Problem<PayrollLedgerHasAdditional>()(
  'PayrollLedgerHasAdditional',
  { type: problemType('PAYROLL_LEDGER_HAS_ADDITIONAL'), status: 409, title: 'Regular ledger has additional ledgers' },
  { code: Schema.tag('PAYROLL_LEDGER_HAS_ADDITIONAL') },
) {}

/** HR에 없는 직원입니다. */
export class EmployeeNotFound extends HttpApiError.Problem<EmployeeNotFound>()(
  'EmployeeNotFound',
  { type: problemType('EMPLOYEE_NOT_FOUND'), status: 422, title: 'Employee not found' },
  { code: Schema.tag('EMPLOYEE_NOT_FOUND') },
) {}

/** 그 달에 적용할 기준표가 없습니다. */
export class RateTableNotFound extends HttpApiError.Problem<RateTableNotFound>()(
  'RateTableNotFound',
  { type: problemType('RATE_TABLE_NOT_FOUND'), status: 422, title: 'No rate table is in force' },
  { code: Schema.tag('RATE_TABLE_NOT_FOUND'), month: Schema.String },
) {}

/** 기준표 ID가 없습니다. */
export class RateTableIdNotFound extends HttpApiError.Problem<RateTableIdNotFound>()(
  'RateTableIdNotFound',
  { type: problemType('RATE_TABLE_ID_NOT_FOUND'), status: 404, title: 'Rate table not found' },
  { code: Schema.tag('RATE_TABLE_ID_NOT_FOUND') },
) {}

/** 명세서가 없습니다. */
export class PayslipNotFound extends HttpApiError.Problem<PayslipNotFound>()(
  'PayslipNotFound',
  { type: problemType('PAYSLIP_NOT_FOUND'), status: 404, title: 'Payslip not found' },
  { code: Schema.tag('PAYSLIP_NOT_FOUND') },
) {}

/**
 * 명세서 발송이 메일 연동 오류로 중간에 멈췄습니다. 이미 보낸 명세서의 기록은 남습니다.
 * 같은 `Idempotency-Key`·같은 본문으로 다시 보내면 보낸 명세서는 건너뛰고 나머지를 보냅니다.
 */
export class PayslipSendInterrupted extends HttpApiError.Problem<PayslipSendInterrupted>()(
  'PayslipSendInterrupted',
  { type: problemType('PAYSLIP_SEND_INTERRUPTED'), status: 503, title: 'Payslip sending stopped midway' },
  { code: Schema.tag('PAYSLIP_SEND_INTERRUPTED') },
) {}

/** 퇴직금 정산이 없습니다. */
export class SeveranceSettlementNotFound extends HttpApiError.Problem<SeveranceSettlementNotFound>()(
  'SeveranceSettlementNotFound',
  { type: problemType('SEVERANCE_SETTLEMENT_NOT_FOUND'), status: 404, title: 'Severance settlement not found' },
  { code: Schema.tag('SEVERANCE_SETTLEMENT_NOT_FOUND') },
) {}

/** 퇴직금 정산을 만들 수 없는 직원입니다. */
export class SeveranceNotApplicable extends HttpApiError.Problem<SeveranceNotApplicable>()(
  'SeveranceNotApplicable',
  { type: problemType('SEVERANCE_NOT_APPLICABLE'), status: 422, title: 'Severance pay does not apply' },
  {
    code: Schema.tag('SEVERANCE_NOT_APPLICABLE'),
    reason: Schema.Literals(['NOT_LEFT', 'NOT_SEVERANCE_PAY_PLAN']),
  },
) {}

/** 이미 정산이 있는 직원입니다. */
export class SeveranceSettlementExists extends HttpApiError.Problem<SeveranceSettlementExists>()(
  'SeveranceSettlementExists',
  { type: problemType('SEVERANCE_SETTLEMENT_EXISTS'), status: 409, title: 'Severance settlement already exists' },
  { code: Schema.tag('SEVERANCE_SETTLEMENT_EXISTS'), settlementId: Schema.String },
) {}

/** 지금 상태에서 할 수 없는 퇴직금 정산 전이입니다. */
export class SeveranceTransitionInvalid extends HttpApiError.Problem<SeveranceTransitionInvalid>()(
  'SeveranceTransitionInvalid',
  { type: problemType('SEVERANCE_TRANSITION_INVALID'), status: 409, title: 'Severance settlement cannot do this now' },
  { code: Schema.tag('SEVERANCE_TRANSITION_INVALID'), settlementStatus: Schema.String, action: Schema.String },
) {}
