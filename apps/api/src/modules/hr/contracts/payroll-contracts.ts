import { Context, DateTime, Effect, Layer, Option } from 'effect'
import { checkVersion } from '../../../shared/http/versioning.ts'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { VersionMismatch } from '../../../shared/problem/problem.ts'
import { companyDate } from '../../../shared/time/company-date.ts'
import type { Actor } from '../../identity-access/actor.types.ts'
import { MULTIPLIERS_FIVE_OR_MORE, MULTIPLIERS_UNDER_FIVE } from '../../payroll/payroll.public.ts'
import { EmployeeRepository } from '../employees/employee-repository.ts'
import { EmployeeKindNotSupported, EmployeeNotFound, type EmployeeRecord } from '../employees/employee.ts'
import { CompanyWorkforceSize } from '../ports/company-workforce-size.ts'
import { PersonalDataAccessLog } from '../../../shared/personal-data/personal-data-access-log.ts'
import { PersonalDataCipher } from '../../../shared/personal-data/personal-data-cipher.ts'
import { stripUndefined } from '../../../shared/http/strip-undefined.ts'
import { InsuranceFilingRepository, pendingFiling } from '../insurance-filings/insurance-filing-repository.ts'
import { appliedEnrollment } from '../social-insurance/applied-enrollment.ts'
import { SocialInsuranceSettingRepository } from '../social-insurance/social-insurance-setting.ts'
import { entryInEffect } from '../tax-withholding/tax-withholding-history.ts'
import { evaluatePayrollContract } from './payroll-contract-evaluation.ts'
import {
  maskAccountNumber,
  PayrollContractInvalid,
  PayrollContractNotFound,
  PayrollContractRepository,
  type PayrollContract,
  type PayrollContractInput,
  type PayrollContractRecord,
} from './payroll-contract.ts'
import { MINIMUM_HOURLY_WAGE_2026 } from './wage-calculation.ts'
import { contractInForce, workContractStatus } from './work-contract-period.ts'
import { WorkContractRepository } from './work-contract.ts'

/**
 * 급여계약 관리입니다. 근로소득자(`WAGE`)만 가질 수 있습니다.
 *
 * 저장할 때마다 파생 금액(기본급·기준시급·통상시급·수습시급·고정수당·최저임금 판정)을 다시 계산해 둡니다.
 * 최저시급은 아직 Payroll 기준표에 연결하지 않아 {@link MINIMUM_HOURLY_WAGE_2026}을 씁니다.
 * 수습 지급률은 계약 시작일에 유효한 근로계약에서 읽습니다.
 * 자동계산 고정수당의 가산 배수는 저장할 때의 사업장 규모(`CompanyWorkforceSize`, Payroll 급여 설정)로 고릅니다. 상시 5명 이상이면
 * Payroll `MULTIPLIERS_FIVE_OR_MORE`, 4명 이하면 `MULTIPLIERS_UNDER_FIVE`입니다. 규모가 나중에 바뀌어도 저장한 파생 금액은
 * 다시 저장할 때까지 그대로입니다.
 *
 * 보수가 바뀌면 보수 변경 신고(`REMUNERATION_CHANGE`)를 엽니다. 직원의 두 번째 이후 계약이고, 계약 시작일에 국민연금·건강보험·
 * 고용보험 중 하나라도 가입(`appliedEnrollment`)일 때입니다. 첫 계약의 보수는 취득 신고가 다룹니다. 계약의 시작일·지급 단위·금액을
 * 고치면 열린 신고를 닫고 새로 열고, 계약을 지우면 닫습니다.
 */
export class PayrollContracts extends Context.Service<
  PayrollContracts,
  {
    list(actor: Actor, employeeId: Id<'employee'>): Effect.Effect<PayrollContract[], EmployeeNotFound>
    create(
      actor: Actor,
      employeeId: Id<'employee'>,
      input: PayrollContractInput,
    ): Effect.Effect<PayrollContract, EmployeeNotFound | EmployeeKindNotSupported | PayrollContractInvalid>
    get(actor: Actor, id: Id<'payrollContract'>): Effect.Effect<PayrollContract, PayrollContractNotFound>
    update(
      actor: Actor,
      id: Id<'payrollContract'>,
      input: PayrollContractInput,
      expectedVersion: number | undefined,
    ): Effect.Effect<PayrollContract, PayrollContractNotFound | PayrollContractInvalid | VersionMismatch>
    remove(actor: Actor, id: Id<'payrollContract'>): Effect.Effect<void, PayrollContractNotFound>
    revealAccountNumber(
      actor: Actor,
      id: Id<'payrollContract'>,
      reason: string,
    ): Effect.Effect<{ accountNumber: string }, PayrollContractNotFound>
  }
>()('semu/hr/PayrollContracts') {
  static readonly layer = Layer.effect(
    PayrollContracts,
    Effect.gen(function* () {
      const contracts = yield* PayrollContractRepository
      const workContracts = yield* WorkContractRepository
      const employees = yield* EmployeeRepository
      const cipher = yield* PersonalDataCipher
      const accessLog = yield* PersonalDataAccessLog
      const workforceSize = yield* CompanyWorkforceSize
      const filings = yield* InsuranceFilingRepository
      const insuranceSettings = yield* SocialInsuranceSettingRepository
      const now = DateTime.now.pipe(Effect.map(DateTime.formatIso))
      const today = DateTime.now.pipe(Effect.map((at) => companyDate(DateTime.toEpochMillis(at))))

      const findEmployee = (actor: Actor, id: Id<'employee'>) =>
        employees
          .find(actor.companyId, id)
          .pipe(
            Effect.flatMap(
              Option.match({ onNone: () => Effect.fail(new EmployeeNotFound({})), onSome: Effect.succeed }),
            ),
          )

      const findContract = (actor: Actor, id: Id<'payrollContract'>) =>
        contracts
          .find(actor.companyId, id)
          .pipe(
            Effect.flatMap(
              Option.match({ onNone: () => Effect.fail(new PayrollContractNotFound({})), onSome: Effect.succeed }),
            ),
          )

      const requireWage = (employee: EmployeeRecord) =>
        employee.kind === 'WAGE' ? Effect.void : Effect.fail(new EmployeeKindNotSupported({ kind: employee.kind }))

      /** 입력을 평가하고 계좌번호를 암호화해 저장할 필드를 만듭니다. */
      const prepare = Effect.fn('PayrollContracts.prepare')(function* (
        actor: Actor,
        employeeId: Id<'employee'>,
        input: PayrollContractInput,
      ) {
        const workContract = contractInForce(
          (yield* workContracts.list(actor.companyId)).filter((contract) => contract.employeeId === employeeId),
          input.startDate,
        )
        const fiveOrMore = yield* workforceSize.hasFiveOrMoreEmployees(actor.companyId)
        const evaluation = evaluatePayrollContract(input, {
          minimumHourlyWage: MINIMUM_HOURLY_WAGE_2026,
          premiumMultipliers: fiveOrMore ? MULTIPLIERS_FIVE_OR_MORE : MULTIPLIERS_UNDER_FIVE,
          probationPayRatePpm: workContract?.probation?.payRatePpm,
          probationMonths: workContract?.probation?.months,
        })
        if (evaluation.violations.length > 0)
          return yield* new PayrollContractInvalid({ violations: evaluation.violations })
        const { account, ...terms } = input
        return {
          ...terms,
          ...(account === undefined
            ? {}
            : {
                account: {
                  bankCode: account.bankCode,
                  accountNumberEncrypted: yield* cipher.encrypt(
                    'accountNumber',
                    account.accountNumber.replace(/\D/g, ''),
                  ),
                  accountNumberMasked: maskAccountNumber(account.accountNumber),
                  accountHolder: account.accountHolder,
                },
              }),
          derived: evaluation.derived,
          warnings: evaluation.warnings,
        }
      })

      /** 보수 변경 신고를 다시 맞춥니다. 같은 계약의 열린 신고를 닫고, 대상이면 새로 엽니다. */
      const syncRemunerationFiling = Effect.fn('PayrollContracts.syncRemunerationFiling')(function* (
        employee: EmployeeRecord,
        record: PayrollContractRecord,
        at: string,
      ) {
        const source = { type: 'PAYROLL_CONTRACT' as const, id: record.id }
        yield* filings.withdraw(record.companyId, source, 'REMUNERATION_CHANGE', at)
        const others = (yield* contracts.list(record.companyId)).filter(
          (contract) => contract.employeeId === record.employeeId && contract.id !== record.id,
        )
        if (others.length === 0) return
        const settings = Option.getOrUndefined(yield* insuranceSettings.find(record.companyId, record.employeeId))
        const entry = settings === undefined ? undefined : entryInEffect(settings.entries, record.startDate)
        const workContract = contractInForce(
          (yield* workContracts.list(record.companyId)).filter((contract) => contract.employeeId === record.employeeId),
          record.startDate,
        )
        const { recommended } = appliedEnrollment(employee, entry, workContract?.weeklyWorkHours, record.startDate)
        if (!recommended.nps.enrolled && !recommended.nhis.enrolled && !recommended.ei.enrolled) return
        yield* filings.save(
          pendingFiling(
            { companyId: record.companyId, employeeId: record.employeeId },
            'REMUNERATION_CHANGE',
            source,
            { effectiveFrom: record.startDate, wageType: record.wageType, amount: record.amount },
            at,
          ),
        )
      })

      const toView = (record: PayrollContractRecord, asOf: string): PayrollContract => {
        const { companyId: _, account, ...rest } = record
        return {
          ...stripUndefined(rest),
          ...(account === undefined
            ? {}
            : {
                account: {
                  bankCode: account.bankCode,
                  accountNumberMasked: account.accountNumberMasked,
                  accountHolder: account.accountHolder,
                },
              }),
          derived: stripUndefined(record.derived),
          warnings: [...record.warnings],
          status: workContractStatus(record, asOf),
        }
      }

      return PayrollContracts.of({
        list: Effect.fn('PayrollContracts.list')(function* (actor, employeeId) {
          yield* findEmployee(actor, employeeId)
          const asOf = yield* today
          return (yield* contracts.list(actor.companyId))
            .filter((contract) => contract.employeeId === employeeId)
            .map((contract) => toView(contract, asOf))
        }),

        create: Effect.fn('PayrollContracts.create')(function* (actor, employeeId, input) {
          const employee = yield* findEmployee(actor, employeeId)
          yield* requireWage(employee)
          const fields = yield* prepare(actor, employeeId, input)
          const at = yield* now
          const record: PayrollContractRecord = {
            id: newId('payrollContract'),
            companyId: actor.companyId,
            employeeId,
            ...fields,
            version: 1,
            createdAt: at,
            updatedAt: at,
          }
          yield* contracts.save(record)
          yield* syncRemunerationFiling(employee, record, at)
          return toView(record, yield* today)
        }),

        get: Effect.fn('PayrollContracts.get')(function* (actor, id) {
          return toView(yield* findContract(actor, id), yield* today)
        }),

        update: Effect.fn('PayrollContracts.update')(function* (actor, id, input, expectedVersion) {
          const current = yield* findContract(actor, id)
          yield* checkVersion(current.version, expectedVersion)
          const fields = yield* prepare(actor, current.employeeId, input)
          const record: PayrollContractRecord = {
            id: current.id,
            companyId: current.companyId,
            employeeId: current.employeeId,
            ...fields,
            version: current.version + 1,
            createdAt: current.createdAt,
            updatedAt: yield* now,
          }
          yield* contracts.save(record)
          const remunerationChanged =
            record.startDate !== current.startDate ||
            record.wageType !== current.wageType ||
            record.amount !== current.amount
          const employee = Option.getOrUndefined(yield* employees.find(actor.companyId, current.employeeId))
          if (remunerationChanged && employee !== undefined)
            yield* syncRemunerationFiling(employee, record, record.updatedAt)
          return toView(record, yield* today)
        }),

        remove: Effect.fn('PayrollContracts.remove')(function* (actor, id) {
          const contract = yield* findContract(actor, id)
          yield* contracts.remove(actor.companyId, contract.id)
          yield* filings.withdraw(
            actor.companyId,
            { type: 'PAYROLL_CONTRACT', id: contract.id },
            'REMUNERATION_CHANGE',
            yield* now,
          )
        }),

        revealAccountNumber: Effect.fn('PayrollContracts.revealAccountNumber')(function* (actor, id, reason) {
          const contract = yield* findContract(actor, id)
          if (contract.account === undefined) return yield* new PayrollContractNotFound({})
          const accountNumber = yield* cipher.decrypt('accountNumber', contract.account.accountNumberEncrypted)
          yield* accessLog.record({
            companyId: actor.companyId,
            userId: actor.userId,
            target: `payrollContract:${id}:accountNumber`,
            reason,
            at: yield* now,
          })
          return { accountNumber }
        }),
      })
    }),
  )
}
