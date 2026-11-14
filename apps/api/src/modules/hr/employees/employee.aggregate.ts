import { Result } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { Violation } from '../../../shared/problem/problem.types.ts'
import type { OrganizationUnitRecord } from '../organization/organization.ts'
import { checkResignation, isSeveranceSettled, latestCompletedInterimDate } from '../retirement/retirement-rules.ts'
import type { SeveranceSettlementSummary } from '../retirement/retirement.types.ts'
import {
  birthDateFromRegistrationNumber,
  maskIdentityNumber,
  normalizeIdentityNumber,
} from '../shared/identity-number.ts'
import type { IdentityNumberType } from '../shared/identity-number.types.ts'
import { findBlockingDuplicate, type DuplicateCandidate } from './employee-duplicate.ts'
import {
  EmployeeDuplicate,
  EmployeeInvalid,
  ResignationRejected,
  RetirementCompleted,
  type CreateEmployee,
  type EmployeeRecord,
  type Resignation,
  type UpdateEmployee,
} from './employee.ts'

/**
 * 직원 애그리거트입니다(docs/design/domain-model.md). 등록·수정·삭제·퇴직·퇴직 취소의 판정 함수(`decide…`)를 둡니다.
 *
 * 판정 함수는 순수 함수입니다. 시각은 `at`으로, 서비스가 읽어 둔 사실(조직 단위, 같은 번호의 직원과 그 상태, 주민등록번호의
 * 해시·암호문, Payroll의 퇴직금 정산)은 인자로 받습니다. 결과는 저장할 직원이거나 거부입니다.
 *
 * 다른 애그리거트에 미치는 영향(4대보험 취득·상실 신고 열기·철회, 조직 단위의 배치 표시, 가족 삭제)은 domain-model.md 4단계까지
 * 서비스가 판정 뒤에 그대로 합니다. 버전 검사(`If-Match`)도 서비스가 맡습니다.
 */

/** 판정 결과입니다. 직원 변경은 아직 이벤트를 내지 않습니다. */
export interface EmployeeDecision {
  employee: EmployeeRecord
}

/** 신원·소속 입력입니다. 등록과 수정이 함께 씁니다. */
export interface IdentityInput {
  registrationNumber?: string | undefined
  identityType?: IdentityNumberType | undefined
  isForeigner: boolean
  departmentId?: Id<'department'> | null | undefined
  positionId?: Id<'position'> | null | undefined
}

/** 신원·소속 입력을 검사한 결과입니다. 위반이 없고 번호를 받았으면 저장할 형태로 바꾼 번호가 있습니다. */
export interface IdentityPlan {
  violations: Violation[]
  normalized?: { type: IdentityNumberType; value: string }
}

/**
 * 신원·소속 입력을 검사합니다. 없는 부서·직급과 형식이 틀린 번호를 함께 모읍니다. 서비스는 위반이 없고 번호가 있으면 그 번호의
 * 해시·암호문({@link SealedIdentity})과 같은 번호의 직원을 읽어 판정에 넘깁니다.
 */
export function planEmployeeIdentity(input: IdentityInput, units: ReadonlyArray<OrganizationUnitRecord>): IdentityPlan {
  const violations: Violation[] = []
  if (input.departmentId && !units.some((unit) => unit.kind === 'DEPARTMENT' && unit.id === input.departmentId)) {
    violations.push({ field: 'departmentId', code: 'NOT_FOUND' })
  }
  if (input.positionId && !units.some((unit) => unit.kind === 'POSITION' && unit.id === input.positionId)) {
    violations.push({ field: 'positionId', code: 'NOT_FOUND' })
  }
  if (input.registrationNumber === undefined) return { violations }
  const type = input.identityType ?? (input.isForeigner ? 'PASSPORT' : 'RRN')
  const value = normalizeIdentityNumber(input.registrationNumber, type)
  if (value === null) {
    violations.push({ field: 'registrationNumber', code: 'INVALID_FORMAT' })
    return { violations }
  }
  return { violations, normalized: { type, value } }
}

/** 서비스가 개인정보 암호화로 만든 번호의 해시와 암호문입니다. */
export interface SealedIdentity {
  hash: string
  encrypted: string
}

/**
 * 신원 판정이 받는 사실입니다.
 *
 * - `units`: 같은 회사의 조직 단위
 * - `sealed`: 받은 번호의 해시·암호문. 번호를 받지 않았거나 입력이 틀렸으면 `undefined`
 * - `sameNumber`: 같은 소득 구분에서 해시가 같은 직원과 그 지금 상태
 */
export interface EmployeeIdentityFacts {
  units: ReadonlyArray<OrganizationUnitRecord>
  sealed: SealedIdentity | undefined
  sameNumber: ReadonlyArray<DuplicateCandidate>
}

/** 직원 등록 입력입니다. */
export type EmployeeCreation = typeof CreateEmployee.Type & { id: Id<'employee'>; companyId: Id<'company'> }

/**
 * 직원 등록을 판정합니다. 신원·소속이 맞아야 하고, 같은 소득 구분에 같은 번호의 직원이 있으면 거부합니다(재입사로 등록하면
 * 퇴직한 직원은 막지 않음). 생년월일을 주지 않으면 주민등록번호에서 채웁니다.
 */
export function decideEmployeeCreation(
  input: EmployeeCreation,
  facts: EmployeeIdentityFacts,
  at: string,
): Result.Result<EmployeeDecision, EmployeeInvalid | EmployeeDuplicate> {
  const isRejoin = input.isRejoin ?? false
  const isForeigner = input.isForeigner ?? false
  const identity = identityOf(undefined, isRejoin, { ...input, isForeigner }, facts)
  if (Result.isFailure(identity)) return Result.fail(identity.failure)
  const { derivedBirthDate, ...stored } = identity.success
  return Result.succeed({
    employee: {
      id: input.id,
      companyId: input.companyId,
      kind: input.kind,
      name: input.name.trim(),
      ...stored,
      birthDate: input.birthDate ?? derivedBirthDate,
      joinDate: input.joinDate,
      isRejoin,
      departmentId: input.departmentId,
      positionId: input.positionId,
      email: input.email,
      phone: input.phone,
      isForeigner,
      nationalityCode: input.nationalityCode,
      visaCode: input.visaCode,
      version: 1,
      createdAt: at,
      updatedAt: at,
    },
  })
}

/** 직원 수정을 판정합니다. 빠진 필드는 그대로 두고, 부서·직급의 `null`은 지웁니다. 번호를 바꾸면 등록처럼 검사합니다. */
export function decideEmployeeUpdate(
  record: EmployeeRecord,
  patch: typeof UpdateEmployee.Type,
  facts: EmployeeIdentityFacts,
  at: string,
): Result.Result<EmployeeDecision, EmployeeInvalid | EmployeeDuplicate> {
  const isForeigner = patch.isForeigner ?? record.isForeigner
  const identity = identityOf(record.id, record.isRejoin, { ...patch, isForeigner }, facts)
  if (Result.isFailure(identity)) return Result.fail(identity.failure)
  const { derivedBirthDate, ...stored } = identity.success
  return Result.succeed({
    employee: {
      ...record,
      ...stored,
      name: patch.name?.trim() ?? record.name,
      birthDate: patch.birthDate ?? derivedBirthDate ?? record.birthDate,
      joinDate: patch.joinDate ?? record.joinDate,
      departmentId: patch.departmentId === undefined ? record.departmentId : (patch.departmentId ?? undefined),
      positionId: patch.positionId === undefined ? record.positionId : (patch.positionId ?? undefined),
      email: patch.email ?? record.email,
      phone: patch.phone ?? record.phone,
      isForeigner,
      nationalityCode: patch.nationalityCode ?? record.nationalityCode,
      visaCode: patch.visaCode ?? record.visaCode,
      version: record.version + 1,
      updatedAt: at,
    },
  })
}

/** 직원 삭제를 판정합니다. 퇴직금 정산이 끝난 직원은 지우지 않습니다. */
export function decideEmployeeRemoval(
  settlements: ReadonlyArray<SeveranceSettlementSummary>,
): Result.Result<void, RetirementCompleted> {
  return isSeveranceSettled(settlements, 'DELETE') ? Result.fail(new RetirementCompleted({})) : Result.void
}

/**
 * 퇴직 처리를 판정합니다. 퇴직금 정산이 끝난 직원은 거부하고, 퇴직일은 입사일과 마지막 완료 중간정산 기준일 뒤여야 합니다
 * ({@link checkResignation}).
 */
export function decideResignation(
  record: EmployeeRecord,
  resignation: typeof Resignation.Type,
  settlements: ReadonlyArray<SeveranceSettlementSummary>,
  at: string,
): Result.Result<EmployeeDecision, RetirementCompleted | ResignationRejected> {
  if (isSeveranceSettled(settlements, 'RESIGNATION')) return Result.fail(new RetirementCompleted({}))
  const rejection = checkResignation(resignation, {
    joinDate: record.joinDate,
    interimSettlementDate: latestCompletedInterimDate(settlements),
  })
  if (rejection !== undefined) return Result.fail(new ResignationRejected({ reason: rejection }))
  return Result.succeed({ employee: { ...record, resignation, version: record.version + 1, updatedAt: at } })
}

/** 퇴직 취소를 판정합니다. 퇴직한 직원이어야 하고, 퇴직금 정산이 끝났으면 거부합니다. */
export function decideResignationCancel(
  record: EmployeeRecord,
  settlements: ReadonlyArray<SeveranceSettlementSummary>,
  at: string,
): Result.Result<EmployeeDecision, ResignationRejected | RetirementCompleted> {
  if (record.resignation === undefined) return Result.fail(new ResignationRejected({ reason: 'NOT_RESIGNED' }))
  if (isSeveranceSettled(settlements, 'RESIGNATION')) return Result.fail(new RetirementCompleted({}))
  const { resignation: _, ...rest } = record
  return Result.succeed({ employee: { ...rest, version: record.version + 1, updatedAt: at } })
}

/** 저장할 신원 필드입니다. 번호를 받지 않았으면 빈 객체입니다. */
type IdentityFields = Pick<
  EmployeeRecord,
  'identityType' | 'registrationNumberEncrypted' | 'registrationNumberHash' | 'registrationNumberMasked'
> & { derivedBirthDate?: string | undefined }

function identityOf(
  selfId: Id<'employee'> | undefined,
  isRejoin: boolean,
  input: IdentityInput,
  facts: EmployeeIdentityFacts,
): Result.Result<IdentityFields, EmployeeInvalid | EmployeeDuplicate> {
  const plan = planEmployeeIdentity(input, facts.units)
  if (plan.violations.length > 0) return Result.fail(new EmployeeInvalid({ violations: plan.violations }))
  if (plan.normalized === undefined) return Result.succeed({})
  // 번호를 받았으면 서비스가 봉인해 넘깁니다. 빠졌으면 서비스의 실수입니다.
  if (facts.sealed === undefined) throw new Error('Sealed identity is required when a registration number is given')
  const blocking = findBlockingDuplicate(facts.sameNumber, { selfId, isRejoin })
  if (blocking !== undefined) {
    return Result.fail(new EmployeeDuplicate({ duplicateEmployeeId: blocking as Id<'employee'> }))
  }
  const { type, value } = plan.normalized
  return Result.succeed({
    identityType: type,
    registrationNumberEncrypted: facts.sealed.encrypted,
    registrationNumberHash: facts.sealed.hash,
    registrationNumberMasked: maskIdentityNumber(value, type),
    ...(type === 'RRN' ? { derivedBirthDate: birthDateFromRegistrationNumber(value) ?? undefined } : {}),
  })
}
