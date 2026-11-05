import { Effect, Layer, Option } from 'effect'
import type { Id } from '../shared/ids/ids.types.ts'
import { lastDayOfMonth } from '../shared/time/calendar.ts'
import { HrDirectory } from '../modules/hr/hr.public.ts'
import type { DirectoryEmployee, DirectorySocialInsurance, DirectoryWorkContract } from '../modules/hr/hr.public.ts'
import { PayrollEmployeeDirectory } from '../modules/payroll/payroll.public.ts'
import type { EmploymentTrend, PayrollEmployee } from '../modules/payroll/payroll.public.ts'

const STANDARD_WEEKLY_HOURS = 40
const WORKDAYS_PER_WEEK = 5
const MIN_WEEKLY_HOURS_FOR_REST_DAY = 15

/**
 * Payroll이 HR이 아직 저장하지 않는 값에 쓰는 기본값입니다. Payroll 가짜(`PAYROLL_DEMO_EMPLOYEES`)의 월급제 직원과 같습니다.
 */
export const PAYROLL_DEFAULTS_WITHOUT_HR = {
  paymentUnit: 'MONTHLY',
  basePay: 3_000_000,
  hourlyWage: 0,
  dailyWage: 0,
  incomeTax: { dependants: 1, childrenAged8To20: 0, withholdingRatePpm: 1_000_000, manualAmount: null },
  retirementBenefitType: 'SEVERANCE_PAY',
} as const satisfies Pick<
  PayrollEmployee,
  'paymentUnit' | 'basePay' | 'hourlyWage' | 'dailyWage' | 'incomeTax' | 'retirementBenefitType'
>

/**
 * Payroll의 `PayrollEmployeeDirectory` 포트를 HR의 `HrDirectory`로 구현합니다.
 *
 * HR에서 그대로 옮기는 값: 이름, 가린 주민번호, 이메일, 부서 이름, 입사일, 퇴직일(마지막 근무일), 근로소득자(`WAGE`) 여부,
 * 근로계약의 주 소정근로시간에서 구한 월 소정근로시간·1일 주휴시간, 4대보험 자격 판정에서 구한 가입 여부.
 *
 * HR에 아직 없어 {@link PAYROLL_DEFAULTS_WITHOUT_HR}(Payroll 가짜와 같은 값)로 채우는 값입니다. HR에 급여계약·공제 정보 저장소가
 * 생기면 그 값으로 바꿉니다.
 * - 급여계약: 지급 단위(월급제), 기본급(300만 원), 시급·일급(0원)
 * - 소득세 공제 정보: 부양가족 1명, 8–20세 자녀 0명, 원천징수 비율 100%, 직접 입력 세액 없음
 * - 퇴직급여 제도: 퇴직금(`SEVERANCE_PAY`)
 * - 근로계약이 없거나 주 소정근로시간이 없으면 주 40시간(월 209시간, 1일 주휴 480분)으로 봅니다
 * - 주민번호가 없는 직원의 가린 주민번호는 빈 문자열입니다
 * - 4대보험 판정은 대표자·임원·친족 여부를 모르는 채로 합니다
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
      Effect.all([
        hr.findWorkContract(companyId, employee.id, asOf),
        hr.recommendSocialInsurance(companyId, employee.id, asOf),
      ]).pipe(
        Effect.map(([contract, insurance]) =>
          payrollEmployeeOf(employee, Option.getOrUndefined(contract), Option.getOrUndefined(insurance)),
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
  contract: DirectoryWorkContract | undefined,
  insurance: DirectorySocialInsurance | undefined,
): PayrollEmployee {
  const weeklyHours = Math.min(contract?.weeklyWorkHours ?? STANDARD_WEEKLY_HOURS, STANDARD_WEEKLY_HOURS)
  return {
    id: employee.id,
    name: employee.name,
    registrationNumberMasked: employee.registrationNumberMasked ?? '',
    email: employee.email ?? null,
    departmentName: employee.departmentName ?? null,
    joinDate: employee.joinDate,
    leaveDate: employee.leaveDate ?? null,
    ...PAYROLL_DEFAULTS_WITHOUT_HR,
    incomeTax: { ...PAYROLL_DEFAULTS_WITHOUT_HR.incomeTax },
    monthlyStandardHours: monthlyStandardHours(weeklyHours),
    dailyRestMinutes: dailyRestMinutes(weeklyHours),
    socialInsurance: insurance ?? { nationalPension: true, healthInsurance: true, employmentInsurance: true },
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
