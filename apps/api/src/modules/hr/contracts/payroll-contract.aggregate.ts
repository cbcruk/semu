import { Result } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { MULTIPLIERS_FIVE_OR_MORE, MULTIPLIERS_UNDER_FIVE } from '../../payroll/payroll.public.ts'
import type { EmployeeKind } from '../employees/employee-kind.types.ts'
import { EmployeeKindNotSupported } from '../employees/employee.ts'
import { evaluatePayrollContract } from './payroll-contract-evaluation.ts'
import {
  PayrollContractInput as PayrollContractInputSchema,
  PayrollContractInvalid,
  type PayrollContractInput,
  type PayrollContractRecord,
} from './payroll-contract.ts'
import { MINIMUM_HOURLY_WAGE_2026 } from './wage-calculation.ts'
import { contractInForce } from './work-contract-period.ts'
import type { WorkContractRecord } from './work-contract.ts'

/**
 * 급여계약 애그리거트입니다(docs/design/domain-model.md). 생성·수정과 서명 연결·풀기의 판정 함수를 둡니다.
 *
 * 판정은 순수 함수입니다. 서비스가 읽어 둔 사실(그 직원의 근로계약, 상시 근로자 5명 이상인지)과 봉인한 계좌번호는 인자로
 * 받습니다. 계좌번호 봉인은 직원의 주민등록번호처럼 서비스가 합니다. 다만 같은 번호를 찾는 읽기가 없어 판정 전에 봉인합니다.
 *
 * 저장할 때마다 파생 금액을 다시 계산합니다. 수습 지급률은 계약 시작일에 유효한 근로계약에서, 고정수당 가산 배수는 사업장 규모에서
 * 고릅니다. 최저시급은 아직 Payroll 기준표에 잇지 않아 {@link MINIMUM_HOURLY_WAGE_2026}입니다.
 *
 * 보수 변경 신고(`REMUNERATION_CHANGE`) 맞추기는 domain-model.md 4단계(M6 정책)까지 서비스가 판정 뒤에 합니다. 삭제는 막는 규칙이
 * 없어 판정 함수가 없습니다. 급여계약 변경은 이벤트를 내지 않습니다.
 */

/** 판정 결과입니다. */
export interface PayrollContractDecision {
  payrollContract: PayrollContractRecord
}

/** 서비스가 개인정보 암호화로 봉인한 계좌입니다. */
export type SealedAccount = NonNullable<PayrollContractRecord['account']>

/** 판정에 넘기는 사실입니다. */
export interface PayrollContractFacts {
  /** 그 직원의 근로계약 전체입니다. 계약 시작일에 유효한 것의 수습 조건을 씁니다. */
  workContracts: ReadonlyArray<WorkContractRecord>
  /** 상시 근로자가 5명 이상인지입니다(Payroll 급여 설정). */
  hasFiveOrMoreEmployees: boolean
  /** 입력에 계좌가 있으면 봉인한 계좌입니다. */
  account?: SealedAccount | undefined
}

/** 만들 급여계약입니다. ID는 서비스가 정합니다. */
export interface PayrollContractCreation {
  id: Id<'payrollContract'>
  companyId: Id<'company'>
  employeeId: Id<'employee'>
  employeeKind: EmployeeKind
  terms: PayrollContractInput
}

type Fields = Omit<PayrollContractRecord, 'id' | 'companyId' | 'employeeId' | 'version' | 'createdAt' | 'updatedAt'>

/** 입력을 평가해 저장할 필드를 만듭니다. 최저임금·수습 감액 위반이면 거부합니다. */
function fieldsOf(
  terms: PayrollContractInput,
  facts: PayrollContractFacts,
): Result.Result<Fields, PayrollContractInvalid> {
  const workContract = contractInForce(facts.workContracts, terms.startDate)
  const evaluation = evaluatePayrollContract(terms, {
    minimumHourlyWage: MINIMUM_HOURLY_WAGE_2026,
    premiumMultipliers: facts.hasFiveOrMoreEmployees ? MULTIPLIERS_FIVE_OR_MORE : MULTIPLIERS_UNDER_FIVE,
    probationPayRatePpm: workContract?.probation?.payRatePpm,
    probationMonths: workContract?.probation?.months,
  })
  if (evaluation.violations.length > 0)
    return Result.fail(new PayrollContractInvalid({ violations: evaluation.violations }))
  const { account: _, ...rest } = terms
  return Result.succeed({
    ...rest,
    ...(facts.account === undefined ? {} : { account: facts.account }),
    derived: evaluation.derived,
    warnings: evaluation.warnings,
  })
}

/** 급여계약 생성을 판정합니다. 근로소득자(`WAGE`)만 가질 수 있습니다. */
export function decidePayrollContractCreation(
  input: PayrollContractCreation,
  facts: PayrollContractFacts,
  at: string,
): Result.Result<PayrollContractDecision, EmployeeKindNotSupported | PayrollContractInvalid> {
  if (input.employeeKind !== 'WAGE') return Result.fail(new EmployeeKindNotSupported({ kind: input.employeeKind }))
  return Result.map(fieldsOf(input.terms, facts), (fields) => ({
    payrollContract: {
      id: input.id,
      companyId: input.companyId,
      employeeId: input.employeeId,
      ...fields,
      version: 1,
      createdAt: at,
      updatedAt: at,
    },
  }))
}

/**
 * 급여계약 수정을 판정합니다. 입력 전체로 바꿉니다. 서명한 연봉계약서는 계좌를 뺀 근로조건이 그대로일 때만 남깁니다. 계좌만
 * 바꾸면 다시 서명받을 일이 아닙니다.
 */
export function decidePayrollContractUpdate(
  current: PayrollContractRecord,
  terms: PayrollContractInput,
  facts: PayrollContractFacts,
  at: string,
): Result.Result<PayrollContractDecision, PayrollContractInvalid> {
  return Result.map(fieldsOf(terms, facts), (fields) => ({
    payrollContract: {
      id: current.id,
      companyId: current.companyId,
      employeeId: current.employeeId,
      ...fields,
      signedDocumentId: sameTerms(current, terms) ? current.signedDocumentId : undefined,
      version: current.version + 1,
      createdAt: current.createdAt,
      updatedAt: at,
    },
  }))
}

/**
 * 서명 문서 연결을 바꿉니다. `from`을 주면 지금 그 문서를 가리킬 때만 바꿉니다(무효로 풀 때, 그 사이 다시 서명했거나 고친 계약은
 * 그대로 둡니다). 바꿀 것이 없으면 `undefined`입니다. 응답 ETag가 버전이라 연결이 바뀌면 버전도 올립니다.
 */
export function decidePayrollContractSigning(
  contract: PayrollContractRecord,
  to: Id<'document'> | undefined,
  at: string,
  from?: Id<'document'>,
): PayrollContractDecision | undefined {
  if (from !== undefined && contract.signedDocumentId !== from) return undefined
  return { payrollContract: { ...contract, signedDocumentId: to, version: contract.version + 1, updatedAt: at } }
}

/** 계좌를 뺀 근로조건이 같은지입니다. 빈 값(`undefined`)과 빠진 키는 같게 봅니다. */
function sameTerms(current: PayrollContractRecord, input: PayrollContractInput): boolean {
  const keys = Object.keys(PayrollContractInputSchema.fields).filter((key) => key !== 'account')
  const pick = (source: object) =>
    canonical(Object.fromEntries(keys.map((key) => [key, (source as Record<string, unknown>)[key]])))
  return pick(current) === pick(input)
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).toSorted(([a], [b]) => a.localeCompare(b)))
      : inner,
  )
}
