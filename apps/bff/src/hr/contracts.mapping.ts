import { LegacyFields } from '../legacy-body.ts'
import { legacyErrors } from '../legacy-error.ts'
import type {
  FixedAllowance,
  FixedAllowanceKind,
  IndefiniteConversion,
  PayrollContract,
  PayrollContractInput,
  WorkContract,
} from '../upstream.types.ts'

/** 현행 계약 형태(`regular` 기간의 정함이 없음, `contract` 기간제) ↔ 새 계약 형태입니다. */
const CONTRACT_TYPE = { PERMANENT: 'regular', FIXED_TERM: 'contract' } as const

/** 수습 지급률: 현행은 퍼센트(90–100), 새 API는 ppm입니다. */
const PPM_PER_PERCENT = 10_000

/**
 * 현행 근로계약(`work-contracts/`)의 한 행입니다.
 *
 * 새 근로계약에 없는 필드는 비웁니다: 근무 형태(`work_type`은 현행 기본값 `regular`), 담당업무 코드, 근무 조건·근무 일정 정책,
 * 담당 업무 설명, 문서, 전자서명 요청. 새 근로계약은 고칠 수 없어 `updated`는 `created`와 같습니다.
 */
export function toLegacyWorkContract(contract: WorkContract): Record<string, unknown> {
  const probation = contract.probation
  return {
    id: contract.id,
    creation_method: 'manual',
    e_sign_request: null,
    contract_type: CONTRACT_TYPE[contract.contractType],
    start_date: contract.startDate,
    end_date: contract.endDate ?? null,
    status: contract.status.toLowerCase(),
    work_type: 'regular',
    work_code: null,
    work_condition: null,
    work_schedule_policy: null,
    weekly_work_hours: contract.weeklyWorkHours ?? null,
    has_probation: probation !== undefined,
    probation_months: probation?.months ?? null,
    probation_pay_rate:
      probation === undefined
        ? null
        : probation.payRatePpm === undefined
          ? 100
          : probation.payRatePpm / PPM_PER_PERCENT,
    job_description: null,
    document: null,
    created: contract.createdAt,
    updated: contract.createdAt,
  }
}

/** 새 근로계약 입력입니다. */
export interface WorkContractInput {
  contractType: WorkContract['contractType']
  startDate: string
  endDate?: string
  weeklyWorkHours?: number
  probation?: { months?: number; payRatePpm: number }
}

/**
 * 현행 근로계약 본문(`POST work-contracts/`)을 새 입력으로 바꿉니다.
 *
 * 새 근로계약에 자리가 없는 필드(근무 형태, 담당업무 코드, 근무 조건·정책, 업무 설명, 문서)는 기본값이 아니면 422로 거절합니다.
 * 수습 지급률이 없으면 현행처럼 100%입니다.
 */
export function fromLegacyWorkContract(body: Record<string, unknown>): WorkContractInput {
  const fields = new LegacyFields(body)
  const contractType = fields.choice('contract_type', ['regular', 'contract'])
  fields.unsupported('work_type', 'regular')
  for (const name of ['work_code', 'work_condition', 'work_schedule_policy', 'job_description', 'document']) {
    fields.unsupported(name)
  }
  const endDate = fields.optionalDate('end_date')
  const weeklyWorkHours = fields.optionalNumber('weekly_work_hours')
  const months = fields.optionalNumber('probation_months')
  const payRate = fields.optionalNumber('probation_pay_rate')
  return {
    contractType: contractType === 'regular' ? 'PERMANENT' : 'FIXED_TERM',
    startDate: fields.date('start_date'),
    ...(endDate === null ? {} : { endDate }),
    ...(weeklyWorkHours === null ? {} : { weeklyWorkHours }),
    ...(fields.boolean('has_probation', false)
      ? { probation: { ...(months === null ? {} : { months }), payRatePpm: (payRate ?? 100) * PPM_PER_PERCENT } }
      : {}),
  }
}

/** 새 근로계약 위반 필드 → 현행 필드입니다. */
export function workContractField(field: string): string {
  if (field === 'probation.months') return 'probation_months'
  if (field === 'probation.pay_rate_ppm') return 'probation_pay_rate'
  return field
}

/** 현행 무기계약 전환 알림(`work-contracts/indefinite-conversion-alert/`)입니다. 값은 같고 enum만 소문자입니다. */
export function toLegacyIndefiniteConversion(view: IndefiniteConversion): Record<string, unknown> {
  return {
    is_target: view.isTarget,
    status: view.status.toLowerCase(),
    is_exempt: view.isExempt,
    exempt_reason: view.exemptReason?.toLowerCase() ?? null,
    chain_start_date: view.chainStartDate ?? null,
    chain_end_date: view.chainEndDate ?? null,
    total_contract_days: view.totalContractDays,
    conversion_date: view.conversionDate ?? null,
    days_until_conversion: view.daysUntilConversion ?? null,
  }
}

/** 현행 고정수당 이름(`fixed_holiday_overtime_*`) ↔ 새 이름(`holidayOvertime`)입니다. */
const FIXED_KINDS: ReadonlyArray<readonly [FixedAllowanceKind, string]> = [
  ['overtime', 'overtime'],
  ['night', 'night'],
  ['holiday', 'holiday'],
  ['holidayOvertime', 'holiday_overtime'],
]

/** 현행 지급 방법 ↔ 새 지급 방법입니다. 현행 `direct`(직접 지급)는 새 `CASH`입니다. */
const PAY_METHOD = { TRANSFER: 'transfer', CASH: 'direct' } as const

/**
 * 현행 급여계약(`payroll-contracts/`)의 한 행입니다.
 *
 * - 파생 금액(기본급, 시급, 고정수당 금액, 최저임금 판정)은 새 API가 계산한 값입니다. 고정수당 `amount`는 자동계산이면 계산한 금액, 아니면 입력한 금액입니다
 * - 지급항목의 `name`은 새 급여계약에 없어 내보내지 않습니다(항목 이름은 Payroll의 지급항목에 있습니다)
 * - 계좌번호는 새 API가 가린 값(끝 4자리)입니다. 전자서명 요청은 비웁니다
 */
export function toLegacyPayrollContract(contract: PayrollContract): Record<string, unknown> {
  const fixed: Record<string, unknown> = {}
  for (const [kind, legacy] of FIXED_KINDS) {
    const allowance = contract.fixedAllowances?.[kind]
    fixed[`fixed_${legacy}_enabled`] = allowance?.enabled ?? false
    fixed[`fixed_${legacy}_hours`] = allowance?.hours ?? 0
    fixed[`fixed_${legacy}_amount`] = contract.derived.fixedAllowanceAmounts[kind]
  }
  return {
    id: contract.id,
    e_sign_request: null,
    start_date: contract.startDate,
    end_date: contract.endDate ?? null,
    wage_type: contract.wageType.toLowerCase(),
    monthly_work_hours_source: (contract.monthlyWorkHoursSource ?? 'MANUAL').toLowerCase(),
    monthly_work_hours: contract.monthlyWorkHours,
    daily_work_hours: contract.dailyWorkHours ?? null,
    amount: contract.amount,
    base_salary: contract.derived.baseSalary,
    base_hourly_wage: contract.derived.baseHourlyWage,
    probation_hourly_wage: contract.derived.probationHourlyWage ?? null,
    ordinary_hourly_wage: contract.derived.ordinaryHourlyWage,
    payment_items: (contract.paymentItems ?? []).map((item) => ({
      payment_item: item.paymentItemId,
      is_enabled: item.enabled,
      amount: item.amount,
      is_ordinary_wage: item.ordinaryWage ?? true,
      counts_toward_minimum_wage: item.countsTowardMinimumWage ?? true,
    })),
    fixed_wage_auto_calc: contract.fixedAllowanceAutoCalc ?? false,
    ...fixed,
    annual_salary: contract.annualSalary ?? null,
    has_bonus: contract.bonus !== undefined,
    bonus_amount: contract.bonus?.amount ?? null,
    bonus_in_ordinary_wage: contract.bonus?.inOrdinaryWage ?? false,
    pay_month: (contract.payTiming?.month ?? 'CURRENT').toLowerCase(),
    pay_day: contract.payTiming?.day ?? 25,
    pay_method: PAY_METHOD[contract.payMethod ?? 'TRANSFER'],
    bank_code: contract.account?.bankCode ?? null,
    account_number: contract.account?.accountNumberMasked ?? null,
    account_holder: contract.account?.accountHolder ?? null,
    minimum_wage: {
      hourly: contract.derived.statutoryMinimumHourlyWage,
      contract_hourly: contract.derived.minimumWageHourly,
      is_below: contract.warnings.includes('BELOW_MINIMUM_WAGE'),
    },
    created: contract.createdAt,
    updated: contract.updatedAt,
  }
}

/** 현행 급여계약 본문을 바꾼 결과입니다. */
export interface PayrollContractRequest {
  input: PayrollContractInput
  /**
   * 계좌번호가 가린 값(`*` 포함)이거나 빠졌습니다. 현행 서버는 이때 저장된 계좌번호를 유지했습니다.
   * 그대로 두려면 라우트가 지금 계약의 계좌번호를 채워야 합니다.
   */
  keepAccountNumber: { bankCode: string; accountHolder: string } | undefined
}

/**
 * 현행 급여계약 본문(`POST`/`PUT payroll-contracts/`)을 새 입력으로 바꿉니다. 기본값은 현행 서버(zod 스키마)와 같습니다.
 *
 * - 지급항목 ID는 새 지급항목 ID(`pit_…`)여야 합니다. 현행 정수 ID는 데이터 이관 대응표가 생기기 전까지 422입니다
 * - 계좌 이체(`transfer`)면 은행·계좌번호·예금주가 모두 있어야 합니다(현행 규칙). 직접 지급이면 계좌를 보내지 않습니다
 */
export function fromLegacyPayrollContract(body: Record<string, unknown>): PayrollContractRequest {
  const fields = new LegacyFields(body)
  const endDate = fields.optionalDate('end_date')
  const dailyWorkHours = fields.optionalNumber('daily_work_hours')
  const annualSalary = fields.optionalNumber('annual_salary')
  const fixedAllowances: Partial<Record<FixedAllowanceKind, FixedAllowance>> = {}
  for (const [kind, legacy] of FIXED_KINDS) {
    fixedAllowances[kind] = {
      enabled: fields.boolean(`fixed_${legacy}_enabled`, false),
      hours: fields.number(`fixed_${legacy}_hours`, 0),
      amount: fields.number(`fixed_${legacy}_amount`, 0),
    }
  }
  let bonus: PayrollContractInput['bonus']
  if (fields.boolean('has_bonus', false)) {
    const amount = fields.optionalNumber('bonus_amount')
    if (amount === null) throw legacyErrors.invalidField('bonus_amount', 'This field is required.')
    bonus = { amount, inOrdinaryWage: fields.boolean('bonus_in_ordinary_wage', false) }
  }
  const payMethod = fields.choice('pay_method', ['transfer', 'direct'], 'transfer')
  const input: PayrollContractInput = {
    startDate: fields.date('start_date'),
    ...(endDate === null ? {} : { endDate }),
    wageType: fields
      .choice('wage_type', ['monthly', 'daily', 'hourly'])
      .toUpperCase() as PayrollContractInput['wageType'],
    amount: fields.number('amount'),
    monthlyWorkHours: fields.number('monthly_work_hours', 209),
    monthlyWorkHoursSource: fields.choice('monthly_work_hours_source', ['policy', 'manual'], 'manual').toUpperCase() as
      'POLICY' | 'MANUAL',
    ...(dailyWorkHours === null ? {} : { dailyWorkHours }),
    paymentItems: paymentItems(fields.raw('payment_items')),
    fixedAllowanceAutoCalc: fields.boolean('fixed_wage_auto_calc', false),
    fixedAllowances,
    ...(bonus === undefined ? {} : { bonus }),
    ...(annualSalary === null ? {} : { annualSalary }),
    payTiming: {
      month: fields.choice('pay_month', ['current', 'next'], 'current') === 'next' ? 'NEXT' : 'CURRENT',
      day: fields.number('pay_day', 25),
    },
    payMethod: payMethod === 'transfer' ? 'TRANSFER' : 'CASH',
  }
  if (payMethod === 'direct') return { input, keepAccountNumber: undefined }
  const bankCode = fields.optionalText('bank_code')
  const accountHolder = fields.optionalText('account_holder')
  const accountNumber = fields.raw('account_number')
  const missingAccount = () =>
    legacyErrors.invalidField('account_number', 'Bank transfers need a bank, account number and holder.')
  if (bankCode === null || accountHolder === null) throw missingAccount()
  if (accountNumber === undefined || (typeof accountNumber === 'string' && accountNumber.includes('*'))) {
    return { input, keepAccountNumber: { bankCode, accountHolder } }
  }
  const number = fields.optionalText('account_number')
  if (number === null) throw missingAccount()
  return {
    input: { ...input, account: { bankCode, accountNumber: number, accountHolder } },
    keepAccountNumber: undefined,
  }
}

function paymentItems(value: unknown): NonNullable<PayrollContractInput['paymentItems']> {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw legacyErrors.invalidField('payment_items', 'Expected a list of items.')
  return value.map((item: unknown) => {
    if (typeof item !== 'object' || item === null) throw legacyErrors.invalidField('payment_items', 'Invalid value.')
    const fields = new LegacyFields(item as Record<string, unknown>)
    const id = fields.raw('payment_item')
    if (typeof id !== 'string' || !id.startsWith('pit_')) {
      throw legacyErrors.invalidField('payment_items', 'Use payment item IDs from the new API (pit_…).')
    }
    const ordinaryWage = fields.raw('is_ordinary_wage')
    const countsTowardMinimumWage = fields.raw('counts_toward_minimum_wage')
    return {
      paymentItemId: id,
      enabled: fields.boolean('is_enabled', false),
      amount: fields.number('amount'),
      ...(typeof ordinaryWage === 'boolean' ? { ordinaryWage } : {}),
      ...(typeof countsTowardMinimumWage === 'boolean' ? { countsTowardMinimumWage } : {}),
    }
  })
}

/** 새 급여계약 위반 필드 → 현행 필드입니다. 중첩 필드를 현행의 평평한 필드로 되돌립니다. */
export function payrollContractField(field: string): string {
  const fixed = /^fixed_allowances\.([a-z_]+)\.(enabled|hours|amount)$/.exec(field)
  if (fixed !== null) return `fixed_${fixed[1]}_${fixed[2]}`
  if (field.startsWith('payment_items')) return 'payment_items'
  if (field.startsWith('account.')) return field.slice('account.'.length)
  const aliases: Record<string, string> = {
    'pay_timing.day': 'pay_day',
    'pay_timing.month': 'pay_month',
    'bonus.amount': 'bonus_amount',
    'bonus.in_ordinary_wage': 'bonus_in_ordinary_wage',
    fixed_allowance_auto_calc: 'fixed_wage_auto_calc',
  }
  return aliases[field] ?? field
}
