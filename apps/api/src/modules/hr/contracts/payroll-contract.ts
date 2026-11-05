import { Context, Layer, Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import { IdSchema } from '../../../shared/ids/id-schema.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { problemType } from '../../../shared/problem/problem.ts'
import { CalendarDate } from '../../../shared/time/date-schemas.ts'
import { EmployeeId, PayrollContractId, Violations } from '../shared/hr-schemas.ts'
import { makeTenantTable, TableFactory, type TenantTable } from '../../../shared/persistence/record-table.ts'
import type { PayrollContractDerived } from './payroll-contract-evaluation.types.ts'

const Won = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const Hours = Schema.Number.check(Schema.isGreaterThan(0))

/** 급여계약의 지급항목 하나입니다. 항목 정의는 Payroll의 지급항목(`pit_`)입니다. */
export const PayrollContractPaymentItem = Schema.Struct({
  paymentItemId: IdSchema('paymentItem'),
  amount: Won,
  enabled: Schema.Boolean,
  /** 통상임금에 넣는지입니다. 없으면 넣습니다. */
  ordinaryWage: Schema.optionalKey(Schema.Boolean),
  /** 최저임금에 산입하는지입니다. 없으면 산입합니다. */
  countsTowardMinimumWage: Schema.optionalKey(Schema.Boolean),
})

/** 고정 연장·야간·휴일 수당 한 종류입니다. 자동계산이면 `amount`를 무시하고 서버가 채웁니다. */
const FixedAllowance = Schema.Struct({ enabled: Schema.Boolean, hours: Schema.Number, amount: Won })

const fields = {
  startDate: CalendarDate,
  endDate: Schema.optionalKey(CalendarDate),
  wageType: Schema.Literals(['MONTHLY', 'DAILY', 'HOURLY']),
  /** 월급·일급·시급 금액(원)입니다. */
  amount: Won,
  monthlyWorkHours: Hours,
  /** 월 소정근로시간을 근로시간 정책에서 가져왔는지(`POLICY`), 직접 넣었는지(`MANUAL`)입니다. 기본 `MANUAL`. */
  monthlyWorkHoursSource: Schema.optionalKey(Schema.Literals(['POLICY', 'MANUAL'])),
  /** 일급제의 1일 소정근로시간입니다. 없으면 8시간으로 봅니다. */
  dailyWorkHours: Schema.optionalKey(Hours),
  paymentItems: Schema.optionalKey(Schema.Array(PayrollContractPaymentItem)),
  fixedAllowanceAutoCalc: Schema.optionalKey(Schema.Boolean),
  fixedAllowances: Schema.optionalKey(
    Schema.Struct({
      overtime: Schema.optionalKey(FixedAllowance),
      night: Schema.optionalKey(FixedAllowance),
      holiday: Schema.optionalKey(FixedAllowance),
      holidayOvertime: Schema.optionalKey(FixedAllowance),
    }),
  ),
  /** 연 상여금입니다. `inOrdinaryWage`면 12로 나눠 통상임금에 넣습니다. */
  bonus: Schema.optionalKey(Schema.Struct({ amount: Won, inOrdinaryWage: Schema.Boolean })),
  annualSalary: Schema.optionalKey(Won),
  /** 지급 시기입니다. `CURRENT`는 당월, `NEXT`는 익월 `day`일입니다. */
  payTiming: Schema.optionalKey(
    Schema.Struct({
      month: Schema.Literals(['CURRENT', 'NEXT']),
      day: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 31 })),
    }),
  ),
  payMethod: Schema.optionalKey(Schema.Literals(['TRANSFER', 'CASH'])),
}

/** 급여계약 입력입니다. 생성(`POST`)과 전체 교체(`PUT`)가 같이 씁니다. 계좌번호는 원문으로 받아 암호화해 둡니다. */
export const PayrollContractInput = Schema.Struct({
  ...fields,
  account: Schema.optionalKey(
    Schema.Struct({
      bankCode: Schema.String.check(Schema.isPattern(/^\d{3}$/)),
      accountNumber: Schema.String.check(Schema.isPattern(/^[\d-]{6,30}$/)),
      accountHolder: Schema.NonEmptyString,
    }),
  ),
})

/** 급여계약 입력의 타입입니다. */
export type PayrollContractInput = typeof PayrollContractInput.Type

/** 서버가 계산하는 파생 금액입니다. 시급은 소수 둘째 자리까지 반올림한 원입니다. */
export const PayrollContractDerivedSchema = Schema.Struct({
  baseSalary: Schema.Int,
  baseHourlyWage: Schema.Number,
  ordinaryHourlyWage: Schema.Number,
  /** 근로계약에 수습 지급률이 있으면 수습 기준시급입니다. */
  probationHourlyWage: Schema.optionalKey(Schema.Number),
  fixedAllowanceAmounts: Schema.Struct({
    overtime: Schema.Int,
    night: Schema.Int,
    holiday: Schema.Int,
    holidayOvertime: Schema.Int,
  }),
  /** 최저임금 산입 시급입니다. */
  minimumWageHourly: Schema.Number,
  /** 비교한 최저시급(원)입니다. */
  statutoryMinimumHourlyWage: Schema.Int,
})

/** 급여계약 응답입니다. 계좌번호는 끝 4자리만 담고, 원문은 `account-number`로 따로 받습니다. */
export const PayrollContract = Schema.Struct({
  id: PayrollContractId,
  employeeId: EmployeeId,
  ...fields,
  account: Schema.optionalKey(
    Schema.Struct({ bankCode: Schema.String, accountNumberMasked: Schema.String, accountHolder: Schema.String }),
  ),
  derived: PayrollContractDerivedSchema,
  warnings: Schema.Array(Schema.Literal('BELOW_MINIMUM_WAGE')),
  /** 기준일(오늘)의 계약 상태입니다. */
  status: Schema.Literals(['SCHEDULED', 'ACTIVE', 'EXPIRED']),
  version: Schema.Int,
  createdAt: Schema.String,
  updatedAt: Schema.String,
})

/** 급여계약 응답의 타입입니다. */
export type PayrollContract = typeof PayrollContract.Type

/** 저장하는 급여계약입니다. 계좌번호는 암호문과 가린 값으로 나눠 둡니다. 파생 금액은 저장할 때 계산해 둡니다. */
export interface PayrollContractRecord extends Omit<PayrollContractInput, 'account'> {
  id: Id<'payrollContract'>
  companyId: Id<'company'>
  employeeId: Id<'employee'>
  account?: { bankCode: string; accountNumberEncrypted: string; accountNumberMasked: string; accountHolder: string }
  derived: PayrollContractDerived
  warnings: ReadonlyArray<'BELOW_MINIMUM_WAGE'>
  version: number
  createdAt: string
  updatedAt: string
}

/** 급여계약 저장소입니다. */
export class PayrollContractRepository extends Context.Service<
  PayrollContractRepository,
  TenantTable<PayrollContractRecord>
>()('semu/hr/PayrollContractRepository') {
  /** `hr_payroll_contracts` 표에 둡니다. 표가 비어 있으면 `seed`로 시작합니다. 저장 방식은 {@link TableFactory}가 정합니다. */
  static readonly layer = (seed: ReadonlyArray<PayrollContractRecord> = []) =>
    Layer.effect(PayrollContractRepository, makeTenantTable<PayrollContractRecord>('hr_payroll_contracts', seed))

  /** `seed`로 시작해 프로세스 메모리에 급여계약을 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<PayrollContractRecord> = []) =>
    PayrollContractRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}

/** 급여계약이 없거나 다른 회사의 계약입니다. */
export class PayrollContractNotFound extends HttpApiError.Problem<PayrollContractNotFound>()(
  'PayrollContractNotFound',
  { type: problemType('PAYROLL_CONTRACT_NOT_FOUND'), status: 404, title: 'Payroll contract not found' },
  { code: Schema.tag('PAYROLL_CONTRACT_NOT_FOUND') },
) {}

/** 급여계약 입력이 업무 규칙을 어겼습니다. 최저임금 미달은 여기에 들지 않고 `warnings`로 갑니다. */
export class PayrollContractInvalid extends HttpApiError.Problem<PayrollContractInvalid>()(
  'PayrollContractInvalid',
  { type: problemType('PAYROLL_CONTRACT_INVALID'), status: 422, title: 'Payroll contract violates a rule' },
  { code: Schema.tag('PAYROLL_CONTRACT_INVALID'), violations: Violations },
) {}

/** 계좌번호를 끝 4자리만 남기고 가립니다. 예: `********9012` */
export function maskAccountNumber(accountNumber: string): string {
  const digits = accountNumber.replace(/\D/g, '')
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`
}
