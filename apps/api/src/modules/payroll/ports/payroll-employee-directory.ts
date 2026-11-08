import { Context, Effect, Layer, Option } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { lastDayOfMonth } from '../../../shared/time/calendar.ts'

/** 급여 계약의 지급 단위입니다. 근로소득 행의 소득 구분(월급·시급·일급)이 됩니다. */
export type PaymentUnit = 'MONTHLY' | 'HOURLY' | 'DAILY'

/** 회사가 운영하는 퇴직급여 제도입니다. 퇴직금(`SEVERANCE_PAY`)만 급여에서 정산합니다. */
export type RetirementBenefitType = 'SEVERANCE_PAY' | 'DEFINED_BENEFIT' | 'DEFINED_CONTRIBUTION'

/**
 * 급여 계산에 필요한 직원 정보입니다. HR이 기준일 시점의 계약·공제 정보로 채웁니다.
 *
 * 급여는 이 값을 행에 스냅숏으로 복사해 두고, 다시 계산할 때 같은 값을 씁니다(`:refresh-employee-info`로 갱신).
 */
export interface PayrollEmployee {
  id: Id<'employee'>
  name: string
  /** `900101-1******` 형식입니다. 원문은 급여가 받지 않습니다. 대장 행의 소득자 사본으로 복사합니다. */
  registrationNumberMasked: string
  /** 명세서를 보낼 주소입니다. 대장 행의 소득자 사본(`earner`)으로 복사합니다. */
  email: string | null
  departmentName: string | null
  joinDate: string
  /** 마지막 근무일입니다. 재직 중이면 `null`입니다. */
  leaveDate: string | null
  paymentUnit: PaymentUnit
  /** 월급제의 기본급(월)입니다. */
  basePay: number
  /** 시급제의 시급입니다. */
  hourlyWage: number
  /** 일급제의 일급입니다. */
  dailyWage: number
  /** 근로시간 정책에서 구한 월 소정근로시간입니다. 주 40시간이면 209입니다. */
  monthlyStandardHours: number
  /** 근로시간 정책에서 구한 1일 주휴시간(분)입니다. */
  dailyRestMinutes: number
  /** 4대보험 가입 여부입니다. 제외 사유가 있으면 `false`입니다. */
  socialInsurance: { nationalPension: boolean; healthInsurance: boolean; employmentInsurance: boolean }
  /** 간이세액표 입력과 직원별 원천징수 설정입니다. */
  incomeTax: {
    dependants: number
    childrenAged8To20: number
    /**
     * 보육수당 비과세 대상 자녀 수(과세기간 개시일 현재 6세 이하)와 그 값을 정한 설정의 적용 시작일입니다.
     * HR에 값이 없으면 `null`입니다.
     */
    childcareChildren: { count: number; effectiveFrom: string } | null
    withholdingRatePpm: number
    /** 직원별로 소득세를 직접 입력하면 그 금액입니다. */
    manualAmount: number | null
  }
  retirementBenefitType: RetirementBenefitType
}

/** 한 달의 재직 인원 추이입니다. 인건비 보고서에 씁니다. */
export interface EmploymentTrend {
  /** 그 달 말일 재직(휴직 포함) 인원입니다. */
  employed: number
  joined: number
  left: number
}

/**
 * 급여가 HR에 요구하는 직원 조회 포트입니다. HR이 이 포트를 구현한 Layer를 내보내고 `app.ts`에서 연결합니다.
 *
 * 급여는 HR 저장소를 직접 읽지 않습니다.
 */
export class PayrollEmployeeDirectory extends Context.Service<
  PayrollEmployeeDirectory,
  {
    /** 기간 중 하루라도 재직한 근로소득자입니다. 급여대장의 근로 행 후보입니다. */
    listWageEarners(
      companyId: Id<'company'>,
      period: { start: string; end: string },
    ): Effect.Effect<ReadonlyArray<PayrollEmployee>>
    /** `asOf` 시점의 직원 정보입니다. 없으면 `None`입니다. */
    find(
      companyId: Id<'company'>,
      employeeId: Id<'employee'>,
      asOf: string,
    ): Effect.Effect<Option.Option<PayrollEmployee>>
    /**
     * 여러 직원의 지금 퇴직일입니다. 재직 중이면 `leaveDate: null`이고, HR에 없는 직원은 맵에 없습니다.
     *
     * 퇴직금 정산의 HR 퇴직일 대조(`retirementMismatch`)에 씁니다. 정산 목록이 직원 수만큼 `find`를 부르지 않게 한 번에 묻습니다.
     */
    leaveDatesOf(
      companyId: Id<'company'>,
      employeeIds: ReadonlyArray<Id<'employee'>>,
    ): Effect.Effect<ReadonlyMap<Id<'employee'>, { leaveDate: string | null }>>
    /** 한 달(`YYYY-MM`)의 재직·입사·퇴사 인원입니다. */
    employmentTrend(companyId: Id<'company'>, month: string): Effect.Effect<EmploymentTrend>
  }
>()('semu/payroll/PayrollEmployeeDirectory') {
  /** 고정 명부를 쓰는 가짜입니다. HR 구현이 연결되기 전 로컬 개발과 테스트에 씁니다. */
  static readonly layerMemory = (seed: ReadonlyArray<{ companyId: Id<'company'>; employee: PayrollEmployee }> = []) =>
    Layer.succeed(
      PayrollEmployeeDirectory,
      PayrollEmployeeDirectory.of({
        listWageEarners: (companyId, period) =>
          Effect.succeed(
            seed
              .filter((entry) => entry.companyId === companyId)
              .map((entry) => entry.employee)
              .filter(
                (employee) =>
                  employee.joinDate <= period.end &&
                  (employee.leaveDate === null || employee.leaveDate >= period.start),
              ),
          ),
        find: (companyId, employeeId) =>
          Effect.succeed(
            Option.fromNullishOr(
              seed.find((entry) => entry.companyId === companyId && entry.employee.id === employeeId)?.employee,
            ),
          ),
        leaveDatesOf: (companyId, employeeIds) =>
          Effect.succeed(
            new Map(
              seed
                .filter((entry) => entry.companyId === companyId && employeeIds.includes(entry.employee.id))
                .map((entry) => [entry.employee.id, { leaveDate: entry.employee.leaveDate }] as const),
            ),
          ),
        employmentTrend: (companyId, month) => {
          const employees = seed.filter((entry) => entry.companyId === companyId).map((entry) => entry.employee)
          const end = lastDayOfMonth(month)
          return Effect.succeed({
            employed: employees.filter(
              (employee) => employee.joinDate <= end && (employee.leaveDate === null || employee.leaveDate >= end),
            ).length,
            joined: employees.filter((employee) => employee.joinDate.startsWith(month)).length,
            left: employees.filter((employee) => employee.leaveDate?.startsWith(month) === true).length,
          })
        },
      }),
    )
}
