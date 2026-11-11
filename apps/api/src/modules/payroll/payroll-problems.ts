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

/**
 * 행의 소득자가 맞지 않습니다. 근로 행은 직원(`EMPLOYEE_REQUIRED`), 그 밖의 행은 직원이나 소득자 명부의 소득자 하나
 * (`PAYEE_REQUIRED`, 둘 다 주면 `PAYEE_AMBIGUOUS`)가 필요합니다. 명부에 없는 소득자는 `EARNER_NOT_FOUND`이고,
 * 소득 구분은 바꿀 수 없습니다(`INCOME_TYPE_CHANGED`).
 */
export class PayrollRowPayeeInvalid extends HttpApiError.Problem<PayrollRowPayeeInvalid>()(
  'PayrollRowPayeeInvalid',
  { type: problemType('PAYROLL_ROW_PAYEE_INVALID'), status: 422, title: 'Payroll row payee is invalid' },
  {
    code: Schema.tag('PAYROLL_ROW_PAYEE_INVALID'),
    reason: Schema.Literals([
      'EMPLOYEE_REQUIRED',
      'PAYEE_REQUIRED',
      'PAYEE_AMBIGUOUS',
      'EARNER_NOT_FOUND',
      'INCOME_TYPE_CHANGED',
    ]),
  },
) {}

/** 소득자 명부에 없는 소득자이거나 다른 회사의 것입니다. */
export class EarnerNotFound extends HttpApiError.Problem<EarnerNotFound>()(
  'EarnerNotFound',
  { type: problemType('EARNER_NOT_FOUND'), status: 404, title: 'Earner not found' },
  { code: Schema.tag('EARNER_NOT_FOUND') },
) {}

/** 소득자 입력이 규칙에 맞지 않습니다. 신원번호 형식이 틀리면 `registrationNumber`·`INVALID_FORMAT`입니다. */
export class EarnerInvalid extends HttpApiError.Problem<EarnerInvalid>()(
  'EarnerInvalid',
  { type: problemType('EARNER_INVALID'), status: 422, title: 'Earner input violates a rule' },
  {
    code: Schema.tag('EARNER_INVALID'),
    violations: Schema.Array(Schema.Struct({ field: Schema.String, code: Schema.String })),
  },
) {}

/** 같은 신원번호의 소득자가 명부에 이미 있습니다. */
export class EarnerDuplicate extends HttpApiError.Problem<EarnerDuplicate>()(
  'EarnerDuplicate',
  { type: problemType('EARNER_DUPLICATE'), status: 409, title: 'Earner with this identity number exists' },
  { code: Schema.tag('EARNER_DUPLICATE'), duplicateEarnerId: Schema.String },
) {}

/** 급여대장 행이 가리키는 소득자라 지울 수 없습니다. 지급명세서에 신원번호 원문이 필요하기 때문입니다. */
export class EarnerInUse extends HttpApiError.Problem<EarnerInUse>()(
  'EarnerInUse',
  { type: problemType('EARNER_IN_USE'), status: 409, title: 'Earner is referenced by payroll rows' },
  { code: Schema.tag('EARNER_IN_USE') },
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
 * 명세서 발송이 중간에 멈췄습니다(메일 연동·HR 조회·저장 결함). 이미 보낸 명세서의 기록은 남습니다.
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

/**
 * 정산의 마지막 근무일이 HR의 지금 퇴직과 어긋나 완료할 수 없습니다. `reason`은 어긋난 까닭이고 `leaveDate`는 HR의 지금
 * 퇴직일입니다(직원이 없거나 퇴사를 취소했으면 `null`). 정산을 제외하고 지금 퇴직일로 새로 만듭니다.
 */
export class SeveranceRetirementMismatch extends HttpApiError.Problem<SeveranceRetirementMismatch>()(
  'SeveranceRetirementMismatch',
  {
    type: problemType('SEVERANCE_RETIREMENT_MISMATCH'),
    status: 409,
    title: 'Severance settlement no longer matches the retirement in HR',
  },
  {
    code: Schema.tag('SEVERANCE_RETIREMENT_MISMATCH'),
    reason: Schema.Literals(['EMPLOYEE_NOT_FOUND', 'NOT_LEFT', 'LEAVE_DATE_CHANGED']),
    lastWorkDate: Schema.String,
    leaveDate: Schema.NullOr(Schema.String),
  },
) {}

/** 퇴직금 지급일이 마지막 근무일보다 앞섭니다. */
export class SeverancePaymentDateInvalid extends HttpApiError.Problem<SeverancePaymentDateInvalid>()(
  'SeverancePaymentDateInvalid',
  {
    type: problemType('SEVERANCE_PAYMENT_DATE_INVALID'),
    status: 422,
    title: 'Severance payment date is before the last work date',
  },
  { code: Schema.tag('SEVERANCE_PAYMENT_DATE_INVALID'), lastWorkDate: Schema.String },
) {}

/** 지급·공제 항목이 없거나 다른 회사의 것입니다. */
export class PayrollItemNotFound extends HttpApiError.Problem<PayrollItemNotFound>()(
  'PayrollItemNotFound',
  { type: problemType('PAYROLL_ITEM_NOT_FOUND'), status: 404, title: 'Payroll item not found' },
  { code: Schema.tag('PAYROLL_ITEM_NOT_FOUND') },
) {}

/**
 * 지급·공제 항목 입력이 규칙에 맞지 않습니다. `violations`의 `code`는 `REQUIRED`(빈 이름·고정 공제 금액),
 * `UNKNOWN_CATEGORY`(없는 표준 항목), `NAME_FIXED`(표준 항목의 이름), `STANDARD_NAME_RESERVED`(직접 입력에 표준 항목 이름),
 * `RESERVED_NAME`(법정 공제 이름), `NOT_APPLICABLE`(과세 항목의 비과세 한도, 정산 시 입력의 금액), `DUPLICATED`(같은 이름)입니다.
 */
export class PayrollItemInvalid extends HttpApiError.Problem<PayrollItemInvalid>()(
  'PayrollItemInvalid',
  { type: problemType('PAYROLL_ITEM_INVALID'), status: 422, title: 'Payroll item input violates a rule' },
  {
    code: Schema.tag('PAYROLL_ITEM_INVALID'),
    violations: Schema.Array(Schema.Struct({ field: Schema.String, code: Schema.String })),
  },
) {}

/** 지운(보관한) 항목은 고칠 수 없습니다. 이미 만든 대장 행의 계산에만 남아 있습니다. */
export class PayrollItemArchived extends HttpApiError.Problem<PayrollItemArchived>()(
  'PayrollItemArchived',
  { type: problemType('PAYROLL_ITEM_ARCHIVED'), status: 409, title: 'Payroll item is archived' },
  { code: Schema.tag('PAYROLL_ITEM_ARCHIVED') },
) {}

/**
 * 행이 가리키는 지급·공제 항목이 맞지 않습니다. `code`는 `NOT_FOUND`(카탈로그에 없음), `ARCHIVED`(지운 항목을 새로 넣음),
 * `DUPLICATED`(한 행에 같은 항목 둘)입니다. `field`는 `input.paymentItems[0].itemId` 꼴입니다.
 */
export class PayrollRowItemInvalid extends HttpApiError.Problem<PayrollRowItemInvalid>()(
  'PayrollRowItemInvalid',
  { type: problemType('PAYROLL_ROW_ITEM_INVALID'), status: 422, title: 'Payroll row refers to an invalid item' },
  {
    code: Schema.tag('PAYROLL_ROW_ITEM_INVALID'),
    violations: Schema.Array(
      Schema.Struct({ field: Schema.String, code: Schema.Literals(['NOT_FOUND', 'ARCHIVED', 'DUPLICATED']) }),
    ),
  },
) {}
