import { Effect, Layer, Option } from 'effect'
import type { Id } from '../shared/ids/ids.types.ts'
import { lastDayOfMonth } from '../shared/time/calendar.ts'
import { HrDirectory } from '../modules/hr/hr.public.ts'
import type {
  DirectoryEmployee,
  DirectoryPayrollContract,
  DirectorySocialInsurance,
  DirectoryTaxWithholding,
  DirectoryWorkContract,
} from '../modules/hr/hr.public.ts'
import { PayrollEmployeeDirectory } from '../modules/payroll/payroll.public.ts'
import type { EmploymentTrend, PayrollEmployee } from '../modules/payroll/payroll.public.ts'

const STANDARD_WEEKLY_HOURS = 40
const WORKDAYS_PER_WEEK = 5
const MIN_WEEKLY_HOURS_FOR_REST_DAY = 15

/**
 * HR에 값이 없을 때 Payroll에 넘기는 기본값입니다. Payroll 가짜(`PAYROLL_DEMO_EMPLOYEES`)의 월급제 직원과 같습니다.
 *
 * 급여 항목(`paymentUnit`·`basePay`·`hourlyWage`·`dailyWage`)은 기준일에 유효한 급여계약이 없을 때, `incomeTax`는 적용되는
 * 소득세 공제 설정이 없을 때만 씁니다. `retirementBenefitType`은 HR이 퇴직급여 제도를 아직 저장하지 않아 언제나 이 값입니다.
 */
export const PAYROLL_DEFAULTS_WITHOUT_HR = {
  paymentUnit: 'MONTHLY',
  basePay: 3_000_000,
  hourlyWage: 0,
  dailyWage: 0,
  incomeTax: {
    dependants: 1,
    childrenAged8To20: 0,
    childcareChildren: null,
    withholdingRatePpm: 1_000_000,
    manualAmount: null,
  },
  retirementBenefitType: 'SEVERANCE_PAY',
} as const satisfies Pick<
  PayrollEmployee,
  'paymentUnit' | 'basePay' | 'hourlyWage' | 'dailyWage' | 'incomeTax' | 'retirementBenefitType'
>

/**
 * Payroll의 `PayrollEmployeeDirectory` 포트를 HR의 `HrDirectory`로 구현합니다.
 *
 * `leaveDatesOf`는 HR `listLeaveDates` 한 번으로 퇴직일만 읽습니다. 계약·공제·보험은 읽지 않습니다.
 *
 * HR에서 그대로 옮기는 값: 이름, 가린 주민번호, 이메일, 부서 이름, 입사일, 퇴직일(마지막 근무일), 근로소득자(`WAGE`) 여부,
 * 근로계약의 주 소정근로시간에서 구한 월 소정근로시간·1일 주휴시간, 4대보험 가입 여부(`socialInsuranceOf`: 그날 적용되는
 * 4대보험 설정에 자동 판정을 덮어 적용한 값, 설정이 없으면 판정 권장값).
 *
 * 기준일에 유효한 급여계약에서 옮기는 값: 지급 단위(`wageType`), 월급제 기본급(급여계약의 파생 기본급 `baseSalary`, 곧 월급에서
 * 지급항목·고정수당을 뺀 값), 시급제의 시급·일급제의 일급(계약 금액). 해당하지 않는 단위의 금액은 0원입니다.
 *
 * 기준일의 인적공제 대상자에서 세는 값(`countDependants`, 소득세 공제 설정이 없어도 셈): 공제대상 가족 수, 8–20세 자녀 수.
 *
 * 기준일에 적용되는 소득세 공제 설정에서 옮기는 값: 보육수당 비과세 대상 자녀 수
 * (`childcareChildrenCount`와 그 설정의 `effectiveFrom`, 없으면 `null`), 원천징수 비율(조정비율 ppm), 직접 입력 세액(`MANUAL`일 때만, 아니면 `null`).
 *
 * 아직 기본값으로 채우는 값입니다.
 * - 급여계약이 없으면 {@link PAYROLL_DEFAULTS_WITHOUT_HR}의 월급제·기본급 300만 원·시급·일급 0원
 * - 소득세 공제 설정이 없으면 같은 기본값의 원천징수 비율 100%, 직접 입력 세액 없음(가족 수는 위처럼 셉니다)
 * - 보육수당 비과세 대상 자녀 수는 설정에 없으면 `null`(모름)입니다. 급여 엔진이 1명으로 보고 경고합니다
 * - 퇴직급여 제도는 HR에 저장소가 없어 언제나 퇴직금(`SEVERANCE_PAY`)
 * - 급여계약의 지급항목·고정수당·상여·지급 시기·계좌, 소득세 감면·학자금 상환은 Payroll 포트에 자리가 없어 넘기지 않습니다
 * - 월 소정근로시간은 급여계약이 아니라 근로계약의 주 소정근로시간에서 구하고, 근로계약이 없거나 주 소정근로시간이 없으면
 *   주 40시간(월 209시간, 1일 주휴 480분)으로 봅니다
 * - 주민번호가 없는 직원의 가린 주민번호는 빈 문자열입니다
 * - 4대보험 설정이 없으면 판정은 대표자·임원·친족 여부를 모르는 채로 합니다
 */
export const PayrollEmployeeDirectoryFromHr: Layer.Layer<PayrollEmployeeDirectory, never, HrDirectory> = Layer.effect(
  PayrollEmployeeDirectory,
  Effect.gen(function* () {
    const hr = yield* HrDirectory

    const toPayrollEmployee = (
      companyId: Id<'company'>,
      employee: DirectoryEmployee,
      asOf: string,
    ): Effect.Effect<PayrollEmployee> =>
      Effect.all({
        workContract: hr.findWorkContract(companyId, employee.id, asOf),
        payrollContract: hr.findPayrollContract(companyId, employee.id, asOf),
        taxWithholding: hr.findTaxWithholding(companyId, employee.id, asOf),
        insurance: hr.socialInsuranceOf(companyId, employee.id, asOf),
        dependants: hr.countDependants(companyId, employee.id, asOf),
      }).pipe(
        Effect.map((found) =>
          payrollEmployeeOf(employee, {
            workContract: Option.getOrUndefined(found.workContract),
            payrollContract: Option.getOrUndefined(found.payrollContract),
            taxWithholding: Option.getOrUndefined(found.taxWithholding),
            insurance: Option.getOrUndefined(found.insurance),
            dependants: found.dependants,
          }),
        ),
      )

    return PayrollEmployeeDirectory.of({
      listWageEarners: (companyId, period) =>
        hr
          .listEmployeesEmployedBetween(companyId, period.start, period.end, ['WAGE'])
          .pipe(
            Effect.flatMap((employees) =>
              Effect.forEach(employees, (employee) =>
                toPayrollEmployee(companyId, employee, contractDateIn(employee, period.end)),
              ),
            ),
          ),
      find: (companyId, employeeId, asOf) =>
        hr.findEmployee(companyId, employeeId, asOf).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.succeed(Option.none<PayrollEmployee>()),
              onSome: (employee) => toPayrollEmployee(companyId, employee, asOf).pipe(Effect.map(Option.some)),
            }),
          ),
        ),
      leaveDatesOf: (companyId, employeeIds) =>
        hr
          .listLeaveDates(companyId, employeeIds)
          .pipe(
            Effect.map(
              (leaveDates) =>
                new Map([...leaveDates].map(([employeeId, leaveDate]) => [employeeId, { leaveDate }] as const)),
            ),
          ),
      employmentTrend: (companyId, month) =>
        hr
          .listEmployeesEmployedBetween(companyId, `${month}-01`, lastDayOfMonth(month), ['WAGE'])
          .pipe(Effect.map((employees) => employmentTrendOf(employees, month))),
    })
  }),
)

function contractDateIn(employee: DirectoryEmployee, periodEnd: string): string {
  return employee.leaveDate !== undefined && employee.leaveDate < periodEnd ? employee.leaveDate : periodEnd
}

function payrollEmployeeOf(
  employee: DirectoryEmployee,
  hr: {
    workContract: DirectoryWorkContract | undefined
    payrollContract: DirectoryPayrollContract | undefined
    taxWithholding: DirectoryTaxWithholding | undefined
    insurance: DirectorySocialInsurance | undefined
    dependants: { dependantsCount: number; childrenAged8To20Count: number }
  },
): PayrollEmployee {
  const weeklyHours = Math.min(hr.workContract?.weeklyWorkHours ?? STANDARD_WEEKLY_HOURS, STANDARD_WEEKLY_HOURS)
  return {
    id: employee.id,
    name: employee.name,
    registrationNumberMasked: employee.registrationNumberMasked ?? '',
    email: employee.email ?? null,
    departmentName: employee.departmentName ?? null,
    joinDate: employee.joinDate,
    leaveDate: employee.leaveDate ?? null,
    ...payOf(hr.payrollContract),
    incomeTax: {
      ...incomeTaxOf(hr.taxWithholding),
      dependants: hr.dependants.dependantsCount,
      childrenAged8To20: hr.dependants.childrenAged8To20Count,
    },
    retirementBenefitType: PAYROLL_DEFAULTS_WITHOUT_HR.retirementBenefitType,
    monthlyStandardHours: monthlyStandardHours(weeklyHours),
    dailyRestMinutes: dailyRestMinutes(weeklyHours),
    socialInsurance: hr.insurance ?? { nationalPension: true, healthInsurance: true, employmentInsurance: true },
  }
}

function payOf(
  contract: DirectoryPayrollContract | undefined,
): Pick<PayrollEmployee, 'paymentUnit' | 'basePay' | 'hourlyWage' | 'dailyWage'> {
  if (contract === undefined) {
    const { paymentUnit, basePay, hourlyWage, dailyWage } = PAYROLL_DEFAULTS_WITHOUT_HR
    return { paymentUnit, basePay, hourlyWage, dailyWage }
  }
  return {
    paymentUnit: contract.wageType,
    basePay: contract.wageType === 'MONTHLY' ? contract.baseSalary : 0,
    hourlyWage: contract.wageType === 'HOURLY' ? contract.amount : 0,
    dailyWage: contract.wageType === 'DAILY' ? contract.amount : 0,
  }
}

function incomeTaxOf(settings: DirectoryTaxWithholding | undefined): PayrollEmployee['incomeTax'] {
  if (settings === undefined) return { ...PAYROLL_DEFAULTS_WITHOUT_HR.incomeTax }
  return {
    dependants: settings.dependantsCount,
    childrenAged8To20: settings.childrenAged8To20Count,
    childcareChildren:
      settings.childcareChildrenCount === undefined
        ? null
        : { count: settings.childcareChildrenCount, effectiveFrom: settings.effectiveFrom },
    withholdingRatePpm: settings.adjustmentRatePpm,
    manualAmount: settings.calcMethod === 'MANUAL' ? (settings.manualIncomeTax ?? null) : null,
  }
}

function monthlyStandardHours(weeklyHours: number): number {
  const paidWeeklyHours =
    weeklyHours >= MIN_WEEKLY_HOURS_FOR_REST_DAY ? weeklyHours * (1 + 1 / WORKDAYS_PER_WEEK) : weeklyHours
  return Math.round((paidWeeklyHours * 365) / 7 / 12)
}

function dailyRestMinutes(weeklyHours: number): number {
  return weeklyHours >= MIN_WEEKLY_HOURS_FOR_REST_DAY ? Math.round((weeklyHours / WORKDAYS_PER_WEEK) * 60) : 0
}

function employmentTrendOf(employees: ReadonlyArray<DirectoryEmployee>, month: string): EmploymentTrend {
  const end = lastDayOfMonth(month)
  return {
    employed: employees.filter(
      (employee) => employee.joinDate <= end && (employee.leaveDate === undefined || employee.leaveDate >= end),
    ).length,
    joined: employees.filter((employee) => employee.joinDate.startsWith(month)).length,
    left: employees.filter((employee) => employee.leaveDate?.startsWith(month) === true).length,
  }
}
