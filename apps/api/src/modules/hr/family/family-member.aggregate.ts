import { Result } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { EmployeeKind } from '../employees/employee-kind.types.ts'
import { EmployeeKindNotSupported } from '../employees/employee.ts'
import { OPEN_STATUSES } from '../insurance-filings/insurance-filing-rules.ts'
import type { InsuranceFiling, InsuranceFilingPayloads } from '../insurance-filings/insurance-filing.types.ts'
import { maskIdentityNumber } from '../shared/identity-number.ts'
import { dependantChange, isRegisteredDependant, validateFamilyMember } from './family-member-rules.ts'
import {
  FamilyMemberDependantRegistered,
  FamilyMemberInvalid,
  type FamilyMemberInput,
  type FamilyMemberRecord,
} from './family-member.ts'

/**
 * 가족(인적공제 대상자) 애그리거트입니다(docs/design/domain-model.md). 등록·수정·삭제의 판정 함수를 둡니다.
 *
 * 주민등록번호 봉인은 직원처럼 서비스가 합니다. 서비스는 {@link planFamilyMember}로 (등록이면 {@link planFamilyMemberCreation}) 소득 구분과 입력을 먼저 검사해 틀리면 봉인하지
 * 않고 거부하고, 맞으면 정규화한 번호를 암호화해 판정에 넘깁니다. 가리기는 판정이 합니다. 열람과 열람 기록도 서비스가 합니다.
 *
 * 건강보험 피부양자 신고 맞추기는 domain-model.md 4단계(M6 정책)까지 서비스가 합니다. 판정은 그 가족의 피부양자 신고를 받아
 * 무엇을 거두고 열지(`filings`)만 알려 줍니다. 가족은 이벤트를 내지 않습니다. 직원 삭제와 묶인 가족 삭제는 직원 쪽이 합니다.
 */

/** 그 가족을 원인으로 하는 피부양자 신고입니다. */
export type DependantFiling = Extract<InsuranceFiling, { kind: 'DEPENDANT' }>

/** 판정이 알려 주는 피부양자 신고 변경입니다. 적힌 순서대로 합니다. */
export type DependantFilingChange =
  { action: 'WITHDRAW' } | { action: 'OPEN'; payload: InsuranceFilingPayloads['DEPENDANT'] }

/** 판정 결과입니다. */
export interface FamilyMemberDecision {
  member: FamilyMemberRecord
  filings: DependantFilingChange[]
}

type Fields = Omit<
  FamilyMemberRecord,
  'id' | 'companyId' | 'employeeId' | 'version' | 'registrationNumberEncrypted' | 'registrationNumberMasked'
>

/** 검사를 통과한 입력입니다. 번호를 받았으면 정규화한 번호가 있고, 서비스가 그것을 봉인합니다. */
export interface FamilyMemberPlan {
  fields: Fields
  registrationNumber?: string | undefined
}

/**
 * 수정 입력을 검사합니다. 빠진 선택 값은 기본값으로 채웁니다. 기준일 `asOf`는 보육수당 대상 나이와 연말정산 나이 판정에 씁니다.
 */
export function planFamilyMember(
  input: FamilyMemberInput,
  asOf: string,
): Result.Result<FamilyMemberPlan, FamilyMemberInvalid> {
  const terms = {
    relation: input.relation,
    birthDate: input.birthDate,
    registrationNumber: input.registrationNumber,
    taxFreeTarget: input.taxFreeTarget ?? false,
    yearEndTarget: input.yearEndTarget ?? false,
    yearEndDependantType: input.yearEndDependantType ?? 'NOT_ELIGIBLE',
    healthInsuranceDependant: input.healthInsuranceDependant ?? false,
  }
  const result = validateFamilyMember(terms, asOf)
  if (result.violations.length > 0) return Result.fail(new FamilyMemberInvalid({ violations: result.violations }))
  const { registrationNumber: _, ...rest } = terms
  return Result.succeed({
    fields: { ...rest, name: input.name, isForeigner: input.isForeigner ?? false },
    registrationNumber: result.registrationNumber,
  })
}

/** 등록 입력을 검사합니다. 직원의 소득 구분을 먼저 봅니다(근로소득자만). */
export function planFamilyMemberCreation(
  input: FamilyMemberInput,
  asOf: string,
  employeeKind: EmployeeKind,
): Result.Result<FamilyMemberPlan, EmployeeKindNotSupported | FamilyMemberInvalid> {
  if (employeeKind !== 'WAGE') return Result.fail(new EmployeeKindNotSupported({ kind: employeeKind }))
  return planFamilyMember(input, asOf)
}

/** 서비스가 봉인한 번호입니다. 번호가 없으면 `undefined`입니다. */
export type SealedRegistrationNumber = string | undefined

function stored(plan: FamilyMemberPlan, encrypted: SealedRegistrationNumber) {
  return {
    ...plan.fields,
    registrationNumberEncrypted: plan.registrationNumber === undefined ? undefined : encrypted,
    registrationNumberMasked:
      plan.registrationNumber === undefined ? undefined : maskIdentityNumber(plan.registrationNumber, 'RRN'),
  }
}

/** 만들 가족입니다. ID는 서비스가 정합니다. */
export interface FamilyMemberCreation {
  id: Id<'familyMember'>
  companyId: Id<'company'>
  employeeId: Id<'employee'>
}

/** 가족 등록을 판정합니다. 피부양자면 취득 신고를 엽니다. */
export function decideFamilyMemberCreation(
  input: FamilyMemberCreation,
  plan: FamilyMemberPlan,
  encrypted: SealedRegistrationNumber,
  own: ReadonlyArray<DependantFiling>,
): FamilyMemberDecision {
  const member: FamilyMemberRecord = { ...input, ...stored(plan, encrypted), version: 1 }
  return { member, filings: dependantFilingChanges(member, member.healthInsuranceDependant, own) }
}

/** 가족 수정을 판정합니다. 입력 전체로 바꾸고 번호를 빼면 지웁니다. 피부양자 여부가 공단 상태와 다르면 신고를 맞춥니다. */
export function decideFamilyMemberUpdate(
  current: FamilyMemberRecord,
  plan: FamilyMemberPlan,
  encrypted: SealedRegistrationNumber,
  own: ReadonlyArray<DependantFiling>,
): FamilyMemberDecision {
  const member: FamilyMemberRecord = {
    id: current.id,
    companyId: current.companyId,
    employeeId: current.employeeId,
    ...stored(plan, encrypted),
    version: current.version + 1,
  }
  return { member, filings: dependantFilingChanges(member, member.healthInsuranceDependant, own) }
}

/** 가족 삭제를 판정합니다. 공단에 등록된 피부양자는 지우지 않습니다. 열린 취득 신고는 거둡니다. */
export function decideFamilyMemberRemoval(
  member: FamilyMemberRecord,
  own: ReadonlyArray<DependantFiling>,
): Result.Result<{ filings: DependantFilingChange[] }, FamilyMemberDependantRegistered> {
  if (isRegisteredDependant(own)) return Result.fail(new FamilyMemberDependantRegistered({}))
  return Result.succeed({ filings: dependantFilingChanges(member, false, own) })
}

/**
 * 피부양자 신고를 가족의 지금 상태에 맞추는 변경입니다. 공단에 등록된 상태(마지막 완료 신고)와 원하는 상태가 다르면 열린 신고를
 * 거두고 취득·상실 신고를 엽니다. 같으면 열린 신고를 거둡니다. 내용이 같은 열린 신고가 있거나, 열 것도 열린 것도 없으면 아무것도
 * 하지 않습니다.
 */
export function dependantFilingChanges(
  member: FamilyMemberRecord,
  wanted: boolean,
  own: ReadonlyArray<DependantFiling>,
): DependantFilingChange[] {
  const change = dependantChange(wanted, own)
  const payload: InsuranceFilingPayloads['DEPENDANT'] | undefined =
    change === undefined
      ? undefined
      : { familyMemberId: member.id, change, name: member.name, relation: member.relation, birthDate: member.birthDate }
  const open = own.filter((filing) => OPEN_STATUSES.includes(filing.status))
  if (payload === undefined ? open.length === 0 : open.some((filing) => samePayload(filing.payload, payload))) return []
  return payload === undefined ? [{ action: 'WITHDRAW' }] : [{ action: 'WITHDRAW' }, { action: 'OPEN', payload }]
}

function samePayload(a: InsuranceFilingPayloads['DEPENDANT'], b: InsuranceFilingPayloads['DEPENDANT']): boolean {
  return (
    a.familyMemberId === b.familyMemberId &&
    a.change === b.change &&
    a.name === b.name &&
    a.relation === b.relation &&
    a.birthDate === b.birthDate
  )
}
