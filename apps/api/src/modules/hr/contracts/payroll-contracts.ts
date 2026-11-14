import { Context, DateTime, Effect, Layer, Option } from 'effect'
import { checkVersion } from '../../../shared/http/versioning.ts'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { VersionMismatch } from '../../../shared/problem/problem.ts'
import { companyDate } from '../../../shared/time/company-date.ts'
import type { Actor } from '../../identity-access/actor.types.ts'
import { EmployeeRepository } from '../employees/employee-repository.ts'
import { EmployeeNotFound, type EmployeeKindNotSupported } from '../employees/employee.ts'
import { CompanyWorkforceSize } from '../ports/company-workforce-size.ts'
import { PersonalDataAccessLog } from '../../../shared/personal-data/personal-data-access-log.ts'
import { PersonalDataCipher } from '../../../shared/personal-data/personal-data-cipher.ts'
import { stripUndefined } from '../../../shared/http/strip-undefined.ts'
import { InsuranceFilingRepository, pendingFiling } from '../insurance-filings/insurance-filing-repository.ts'
import { appliedEnrollment } from '../social-insurance/applied-enrollment.ts'
import { SocialInsuranceSettingRepository } from '../social-insurance/social-insurance-setting.ts'
import { entryInEffect } from '../tax-withholding/tax-withholding-history.ts'
import {
  decidePayrollContractCreation,
  decidePayrollContractUpdate,
  type PayrollContractFacts,
} from './payroll-contract.aggregate.ts'
import { type RemunerationChange, remunerationChanges } from './remuneration-change.ts'
import {
  maskAccountNumber,
  type PayrollContractInvalid,
  PayrollContractNotFound,
  PayrollContractRepository,
  type PayrollContract,
  type PayrollContractInput,
  type PayrollContractRecord,
} from './payroll-contract.ts'
import { contractInForce, workContractStatus } from './work-contract-period.ts'
import { WorkContractRepository } from './work-contract.ts'

/** 보수 변경 신고 내용이 같은지 봅니다. */
function samePayload(a: RemunerationChange['payload'], b: RemunerationChange['payload']): boolean {
  return a.effectiveFrom === b.effectiveFrom && a.wageType === b.wageType && a.amount === b.amount
}

/**
 * 급여계약 관리입니다. 근로소득자(`WAGE`)만 가질 수 있습니다.
 *
 * 저장할 때마다 파생 금액(기본급·기준시급·통상시급·수습시급·고정수당·최저임금 판정)을 다시 계산해 둡니다.
 * 최저시급은 아직 Payroll 기준표에 연결하지 않아 `MINIMUM_HOURLY_WAGE_2026`을 씁니다. 판정은 `payroll-contract.aggregate.ts`입니다.
 * 수습 지급률은 계약 시작일에 유효한 근로계약에서 읽습니다.
 * 자동계산 고정수당의 가산 배수는 저장할 때의 사업장 규모(`CompanyWorkforceSize`, Payroll 급여 설정)로 고릅니다. 상시 5명 이상이면
 * Payroll `MULTIPLIERS_FIVE_OR_MORE`, 4명 이하면 `MULTIPLIERS_UNDER_FIVE`입니다. 규모가 나중에 바뀌어도 저장한 파생 금액은
 * 다시 저장할 때까지 그대로입니다.
 *
 * 계약을 등록·수정·삭제하면 직원의 보수 변경 신고(`REMUNERATION_CHANGE`)를 계약 전체에 다시 맞춥니다. 시작일 순으로 바로 앞
 * 계약과 지급 단위나 금액이 다르고, 그날 국민연금·건강보험·고용보험 중 하나라도 가입(`appliedEnrollment`)인 계약이 대상입니다
 * ({@link remunerationChanges}). 가장 이른 계약의 보수는 취득 신고가 다룹니다.
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

      /** 판정에 넘길 사실을 읽고 계좌번호를 봉인합니다. */
      const factsOf = Effect.fn('PayrollContracts.factsOf')(function* (
        actor: Actor,
        employeeId: Id<'employee'>,
        input: PayrollContractInput,
      ) {
        const { account } = input
        return {
          workContracts: (yield* workContracts.list(actor.companyId)).filter(
            (contract) => contract.employeeId === employeeId,
          ),
          hasFiveOrMoreEmployees: yield* workforceSize.hasFiveOrMoreEmployees(actor.companyId),
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
        } satisfies PayrollContractFacts
      })

      /**
       * 직원의 보수 변경 신고를 계약 전체에 다시 맞춥니다({@link remunerationChanges}). 있어야 할 신고와 내용이 같은 신고(열렸거나
       * 완료된)가 있으면 그대로 두고, 아니면 그 계약의 열린 신고를 닫고 새로 엽니다. 더는 대상이 아닌 계약(지운 계약 포함)의 열린
       * 신고는 닫습니다. 계약을 등록·수정·삭제할 때마다 불러, 첫 계약을 고치거나 지워 순서가 바뀌는 경우도 맞춥니다.
       */
      const syncRemunerationFilings = Effect.fn('PayrollContracts.syncRemunerationFilings')(function* (
        companyId: Id<'company'>,
        employeeId: Id<'employee'>,
        at: string,
      ) {
        const employee = Option.getOrUndefined(yield* employees.find(companyId, employeeId))
        const own = (yield* contracts.list(companyId)).filter((contract) => contract.employeeId === employeeId)
        const settings = Option.getOrUndefined(yield* insuranceSettings.find(companyId, employeeId))
        const ownWorkContracts = (yield* workContracts.list(companyId)).filter(
          (contract) => contract.employeeId === employeeId,
        )
        const enrolledOn = (date: string) => {
          if (employee === undefined || employee.kind !== 'WAGE') return false
          const entry = settings === undefined ? undefined : entryInEffect(settings.entries, date)
          const { recommended } = appliedEnrollment(
            employee,
            entry,
            contractInForce(ownWorkContracts, date)?.weeklyWorkHours,
            date,
          )
          return recommended.nps.enrolled || recommended.nhis.enrolled || recommended.ei.enrolled
        }
        const wanted = new Map(
          remunerationChanges(own, enrolledOn).map((change) => [change.contractId, change.payload]),
        )
        const existing = (yield* filings.listByEmployee(companyId, employeeId)).filter(
          (filing) => filing.kind === 'REMUNERATION_CHANGE' && filing.status !== 'WITHDRAWN',
        )
        const contractIds = new Set([...existing.map((filing) => filing.source.id), ...wanted.keys()])
        for (const contractId of contractIds) {
          const source = { type: 'PAYROLL_CONTRACT' as const, id: contractId }
          const payload = wanted.get(contractId)
          const current = existing.filter((filing) => filing.source.id === contractId)
          if (
            payload !== undefined &&
            current.some((filing) => filing.kind === 'REMUNERATION_CHANGE' && samePayload(filing.payload, payload))
          )
            continue
          yield* filings.withdraw(companyId, source, 'REMUNERATION_CHANGE', at)
          if (payload === undefined) continue
          yield* filings.save(pendingFiling({ companyId, employeeId }, 'REMUNERATION_CHANGE', source, payload, at))
        }
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
          const at = yield* now
          const { payrollContract: record } = yield* Effect.fromResult(
            decidePayrollContractCreation(
              {
                id: newId('payrollContract'),
                companyId: actor.companyId,
                employeeId,
                employeeKind: employee.kind,
                terms: input,
              },
              yield* factsOf(actor, employeeId, input),
              at,
            ),
          )
          yield* contracts.save(record)
          yield* syncRemunerationFilings(actor.companyId, employeeId, at)
          return toView(record, yield* today)
        }),

        get: Effect.fn('PayrollContracts.get')(function* (actor, id) {
          return toView(yield* findContract(actor, id), yield* today)
        }),

        update: Effect.fn('PayrollContracts.update')(function* (actor, id, input, expectedVersion) {
          const current = yield* findContract(actor, id)
          yield* checkVersion(current.version, expectedVersion)
          const { payrollContract: record } = yield* Effect.fromResult(
            decidePayrollContractUpdate(current, input, yield* factsOf(actor, current.employeeId, input), yield* now),
          )
          yield* contracts.save(record)
          yield* syncRemunerationFilings(actor.companyId, current.employeeId, record.updatedAt)
          return toView(record, yield* today)
        }),

        remove: Effect.fn('PayrollContracts.remove')(function* (actor, id) {
          const contract = yield* findContract(actor, id)
          yield* contracts.remove(actor.companyId, contract.id)
          yield* syncRemunerationFilings(actor.companyId, contract.employeeId, yield* now)
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
