import { Context, DateTime, Effect, Layer, Option } from 'effect'
import type { Id } from '../../shared/ids/ids.types.ts'
import { WorkContractRepository } from './contracts/work-contract.ts'
import { contractInForce } from './contracts/work-contract-period.ts'
import type { ContractType } from './contracts/work-contract-period.types.ts'
import type { EmployeeKind } from './employees/employee-kind.types.ts'
import { EmployeeRepository } from './employees/employee-repository.ts'
import { deriveEmployeeStatus, lastLeaveDay, wasEmployedBetween } from './employees/employee-status.ts'
import type { EmployeeStatus } from './employees/employee-status.types.ts'
import type { EmployeeRecord } from './employees/employee.ts'
import { LeaveRepository, type LeaveRecord } from './leaves/leave.ts'
import type { LeaveReason } from './leaves/leave-rules.types.ts'
import { PersonalDataAccessLog } from './shared/personal-data-access-log.ts'
import { PersonalDataCipher } from './shared/personal-data-cipher.ts'

/** 다른 컨텍스트에 보이는 직원입니다. 주민번호 원문은 담지 않습니다. */
export interface DirectoryEmployee {
  id: Id<'employee'>
  kind: EmployeeKind
  name: string
  status: EmployeeStatus
  joinDate: string
  leaveDate?: string
  birthDate?: string
  email?: string
  phone?: string
  isForeigner: boolean
  nationalityCode?: string
  visaCode?: string
  departmentId?: Id<'department'>
  positionId?: Id<'position'>
  registrationNumberMasked?: string
}

/** 다른 컨텍스트에 보이는 근로계약입니다. */
export interface DirectoryWorkContract {
  contractType: ContractType
  startDate: string
  endDate?: string
  weeklyWorkHours?: number
}

/** 다른 컨텍스트에 보이는 휴직입니다. */
export interface DirectoryLeave {
  id: Id<'leave'>
  reason: LeaveReason
  startDate: string
  /** 조기 복직이면 복직일 전날입니다. */
  lastDay: string
  includeInServiceYears: boolean
}

/**
 * 인사 컨텍스트의 공개 조회 서비스입니다. 급여·문서 컨텍스트는 인사 데이터를 이것으로만 읽습니다.
 *
 * 상태는 기준일(`asOf`, 회사 시간대 `YYYY-MM-DD`)로 계산합니다. 주민번호 원문은 `revealRegistrationNumber`만
 * 돌려주고, 부를 때마다 열람 기록을 남깁니다.
 */
export class HrDirectory extends Context.Service<
  HrDirectory,
  {
    findEmployee(
      companyId: Id<'company'>,
      employeeId: Id<'employee'>,
      asOf: string,
    ): Effect.Effect<Option.Option<DirectoryEmployee>>
    listEmployees(
      companyId: Id<'company'>,
      filter: { asOf: string; kinds?: ReadonlyArray<EmployeeKind>; statuses?: ReadonlyArray<EmployeeStatus> },
    ): Effect.Effect<ReadonlyArray<DirectoryEmployee>>
    /** 기간 중 하루라도 재직한 직원입니다. 급여대장 대상 고르기에 씁니다. */
    listEmployeesEmployedBetween(
      companyId: Id<'company'>,
      from: string,
      to: string,
      kinds?: ReadonlyArray<EmployeeKind>,
    ): Effect.Effect<ReadonlyArray<DirectoryEmployee>>
    findWorkContract(
      companyId: Id<'company'>,
      employeeId: Id<'employee'>,
      asOf: string,
    ): Effect.Effect<Option.Option<DirectoryWorkContract>>
    listLeavesOverlapping(
      companyId: Id<'company'>,
      employeeId: Id<'employee'>,
      from: string,
      to: string,
    ): Effect.Effect<ReadonlyArray<DirectoryLeave>>
    revealRegistrationNumber(
      companyId: Id<'company'>,
      employeeId: Id<'employee'>,
      access: { userId: Id<'user'>; reason: string },
    ): Effect.Effect<Option.Option<string>>
  }
>()('semu/hr/HrDirectory') {}

/** 인사 저장소 위에 {@link HrDirectory}를 만듭니다. 저장소와 개인정보 포트는 호출하는 쪽이 넣습니다. */
export const HrDirectoryLive = Layer.effect(
  HrDirectory,
  Effect.gen(function* () {
    const employees = yield* EmployeeRepository
    const leaves = yield* LeaveRepository
    const contracts = yield* WorkContractRepository
    const cipher = yield* PersonalDataCipher
    const accessLog = yield* PersonalDataAccessLog

    const leavesOf = (all: ReadonlyArray<LeaveRecord>, employeeId: Id<'employee'>) =>
      all.filter((leave) => leave.employeeId === employeeId)

    const toDirectory = (record: EmployeeRecord, asOf: string, all: ReadonlyArray<LeaveRecord>): DirectoryEmployee => {
      const leaveDate = record.resignation?.leaveDate
      const view: DirectoryEmployee = {
        id: record.id,
        kind: record.kind,
        name: record.name,
        status: deriveEmployeeStatus({ joinDate: record.joinDate, leaveDate, leaves: leavesOf(all, record.id) }, asOf),
        joinDate: record.joinDate,
        isForeigner: record.isForeigner,
      }
      const optional = {
        leaveDate,
        birthDate: record.birthDate,
        email: record.email,
        phone: record.phone,
        nationalityCode: record.nationalityCode,
        visaCode: record.visaCode,
        departmentId: record.departmentId,
        positionId: record.positionId,
        registrationNumberMasked: record.registrationNumberMasked,
      }
      for (const [key, value] of Object.entries(optional))
        if (value !== undefined) Object.assign(view, { [key]: value })
      return view
    }

    const listAll = (companyId: Id<'company'>, asOf: string) =>
      Effect.all([employees.list(companyId), leaves.list(companyId)]).pipe(
        Effect.map(([records, all]) => records.map((record) => toDirectory(record, asOf, all))),
      )

    return HrDirectory.of({
      findEmployee: (companyId, employeeId, asOf) =>
        Effect.all([employees.find(companyId, employeeId), leaves.list(companyId)]).pipe(
          Effect.map(([record, all]) => Option.map(record, (found) => toDirectory(found, asOf, all))),
        ),
      listEmployees: (companyId, filter) =>
        listAll(companyId, filter.asOf).pipe(
          Effect.map((all) =>
            all.filter(
              (employee) =>
                (filter.kinds === undefined || filter.kinds.includes(employee.kind)) &&
                (filter.statuses === undefined || filter.statuses.includes(employee.status)),
            ),
          ),
        ),
      listEmployeesEmployedBetween: (companyId, from, to, kinds) =>
        listAll(companyId, to).pipe(
          Effect.map((all) =>
            all.filter(
              (employee) =>
                (kinds === undefined || kinds.includes(employee.kind)) &&
                wasEmployedBetween({ joinDate: employee.joinDate, leaveDate: employee.leaveDate }, from, to),
            ),
          ),
        ),
      findWorkContract: (companyId, employeeId, asOf) =>
        contracts.list(companyId).pipe(
          Effect.map((all) =>
            Option.fromNullishOr(
              contractInForce(
                all.filter((contract) => contract.employeeId === employeeId),
                asOf,
              ),
            ).pipe(
              Option.map((contract) => {
                const view: DirectoryWorkContract = {
                  contractType: contract.contractType,
                  startDate: contract.startDate,
                }
                if (contract.endDate !== undefined) view.endDate = contract.endDate
                if (contract.weeklyWorkHours !== undefined) view.weeklyWorkHours = contract.weeklyWorkHours
                return view
              }),
            ),
          ),
        ),
      listLeavesOverlapping: (companyId, employeeId, from, to) =>
        leaves.list(companyId).pipe(
          Effect.map((all) =>
            leavesOf(all, employeeId)
              .filter((leave) => leave.startDate <= to && lastLeaveDay(leave) >= from)
              .map((leave) => ({
                id: leave.id,
                reason: leave.reason,
                startDate: leave.startDate,
                lastDay: lastLeaveDay(leave),
                includeInServiceYears: leave.includeInServiceYears,
              })),
          ),
        ),
      revealRegistrationNumber: Effect.fn('HrDirectory.revealRegistrationNumber')(
        function* (companyId, employeeId, access) {
          const record = yield* employees.find(companyId, employeeId)
          if (Option.isNone(record) || record.value.registrationNumberEncrypted === undefined) return Option.none()
          const plain = yield* cipher.decrypt(record.value.registrationNumberEncrypted)
          yield* accessLog.record({
            companyId,
            userId: access.userId,
            target: `employee:${employeeId}:registrationNumber`,
            reason: access.reason,
            at: DateTime.formatIso(yield* DateTime.now),
          })
          return Option.some(plain)
        },
      ),
    })
  }),
)
