import { Context, Layer, Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { makeTenantTable, TableFactory, type TenantTable } from '../../../shared/persistence/record-table.ts'
import { problemType } from '../../../shared/problem/problem.ts'
import { CalendarDate } from '../../../shared/time/date-schemas.ts'
import { EmployeeId, FamilyMemberId, Violations } from '../shared/hr-schemas.ts'
import type { FamilyRelation, YearEndDependantType } from './family-member.types.ts'

/** 근로자와의 관계입니다. */
export const FamilyRelationSchema = Schema.Literals([
  'PARENT',
  'GRANDPARENT',
  'SPOUSE_GRANDPARENT',
  'GREAT_GRANDPARENT',
  'SPOUSE_GREAT_GRANDPARENT',
  'WIFE_PARENT',
  'HUSBAND_PARENT',
  'SPOUSE',
  'CHILD',
  'CHILD_IN_LAW',
  'GRANDCHILD',
  'GREAT_GRANDCHILD',
  'SIBLING',
  'OTHER',
  'NONE',
])

/** 연말정산 기본공제 구분입니다. 연말정산 대상이 아니면 `NOT_ELIGIBLE`입니다. */
export const YearEndDependantTypeSchema = Schema.Literals([
  'NOT_ELIGIBLE',
  'SPOUSE',
  'AGE_20_OR_UNDER',
  'AGE_60_OR_OVER',
  'DISABLED',
  'BASIC_LIVELIHOOD',
  'CHILD_INCENTIVE',
])

/** 가족 등록·수정 본문입니다. 수정은 전체를 바꿉니다. */
export const FamilyMemberInput = Schema.Struct({
  name: Schema.NonEmptyString,
  birthDate: CalendarDate,
  relation: FamilyRelationSchema,
  /** 외국인이면 `true`입니다. 등록번호는 외국인등록번호입니다. 없으면 `false`. */
  isForeigner: Schema.optionalKey(Schema.Boolean),
  /**
   * 주민등록번호 또는 외국인등록번호입니다. 암호화해 두고 응답에는 가린 값만 줍니다. 수정할 때 이 키를 빼면 지웁니다.
   * 피부양자면 신고서에 들어가므로 있어야 합니다.
   */
  registrationNumber: Schema.optionalKey(Schema.String),
  /** 비과세(보육수당) 대상 자녀입니다. 과세기간 개시일 현재 6세 이하 자녀만 됩니다. 없으면 `false`. */
  taxFreeTarget: Schema.optionalKey(Schema.Boolean),
  /** 연말정산 기본공제 대상입니다. 간이세액표의 공제대상 가족 수에 들어갑니다. 없으면 `false`. */
  yearEndTarget: Schema.optionalKey(Schema.Boolean),
  /** 없으면 `NOT_ELIGIBLE`. */
  yearEndDependantType: Schema.optionalKey(YearEndDependantTypeSchema),
  /** 건강보험 피부양자입니다. 바꾸면 피부양자 취득·상실 신고를 엽니다. 없으면 `false`. */
  healthInsuranceDependant: Schema.optionalKey(Schema.Boolean),
})

/** 가족 등록·수정 본문의 타입입니다. */
export type FamilyMemberInput = typeof FamilyMemberInput.Type

/** 가족 응답입니다. */
export const FamilyMember = Schema.Struct({
  id: FamilyMemberId,
  employeeId: EmployeeId,
  name: Schema.String,
  birthDate: CalendarDate,
  relation: FamilyRelationSchema,
  isForeigner: Schema.Boolean,
  /** 예: `900101-1******` */
  registrationNumberMasked: Schema.optionalKey(Schema.String),
  taxFreeTarget: Schema.Boolean,
  yearEndTarget: Schema.Boolean,
  yearEndDependantType: YearEndDependantTypeSchema,
  healthInsuranceDependant: Schema.Boolean,
  version: Schema.Int,
})

/** 가족 응답의 타입입니다. */
export type FamilyMember = typeof FamilyMember.Type

/** 저장하는 가족입니다. 주민번호는 암호문과 가린 값만 둡니다. */
export interface FamilyMemberRecord {
  id: Id<'familyMember'>
  companyId: Id<'company'>
  employeeId: Id<'employee'>
  name: string
  birthDate: string
  relation: FamilyRelation
  isForeigner: boolean
  registrationNumberEncrypted?: string | undefined
  registrationNumberMasked?: string | undefined
  taxFreeTarget: boolean
  yearEndTarget: boolean
  yearEndDependantType: YearEndDependantType
  healthInsuranceDependant: boolean
  version: number
}

/** 가족(인적공제 대상자) 저장소입니다. */
export class FamilyMemberRepository extends Context.Service<FamilyMemberRepository, TenantTable<FamilyMemberRecord>>()(
  'semu/hr/FamilyMemberRepository',
) {
  /** `hr_family_members` 표에 둡니다. 표가 비어 있으면 `seed`로 시작합니다. 저장 방식은 {@link TableFactory}가 정합니다. */
  static readonly layer = (seed: ReadonlyArray<FamilyMemberRecord> = []) =>
    Layer.effect(FamilyMemberRepository, makeTenantTable<FamilyMemberRecord>('hr_family_members', seed))

  /** `seed`로 시작해 프로세스 메모리에 가족을 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<FamilyMemberRecord> = []) =>
    FamilyMemberRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}

/** 가족이 없거나 다른 회사의 가족입니다. */
export class FamilyMemberNotFound extends HttpApiError.Problem<FamilyMemberNotFound>()(
  'FamilyMemberNotFound',
  { type: problemType('FAMILY_MEMBER_NOT_FOUND'), status: 404, title: 'Family member not found' },
  { code: Schema.tag('FAMILY_MEMBER_NOT_FOUND') },
) {}

/**
 * 공단에 피부양자로 등록된 가족은 지울 수 없습니다. 상실 신고에 주민번호가 들어가므로, 먼저 피부양자를 끄고 대리인이
 * 상실 신고를 마친 뒤 지웁니다.
 */
export class FamilyMemberDependantRegistered extends HttpApiError.Problem<FamilyMemberDependantRegistered>()(
  'FamilyMemberDependantRegistered',
  {
    type: problemType('FAMILY_MEMBER_DEPENDANT_REGISTERED'),
    status: 409,
    title: 'Family member is a registered health insurance dependant',
  },
  { code: Schema.tag('FAMILY_MEMBER_DEPENDANT_REGISTERED') },
) {}

/** 가족 입력이 업무 규칙을 어겼습니다. */
export class FamilyMemberInvalid extends HttpApiError.Problem<FamilyMemberInvalid>()(
  'FamilyMemberInvalid',
  { type: problemType('FAMILY_MEMBER_INVALID'), status: 422, title: 'Family member input violates a rule' },
  { code: Schema.tag('FAMILY_MEMBER_INVALID'), violations: Violations },
) {}
