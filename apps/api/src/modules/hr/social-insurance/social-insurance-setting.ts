import { Context, Layer, Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { makeTenantTable, TableFactory, type TenantTable } from '../../../shared/persistence/record-table.ts'
import { problemType } from '../../../shared/problem/problem.ts'
import { CalendarDate } from '../../../shared/time/date-schemas.ts'
import { EmployeeId, Violations } from '../shared/hr-schemas.ts'

/** 가입 제외 사유 코드입니다. 표시 문자열은 참조 데이터가 줍니다. */
export const ExclusionReasonSchema = Schema.Literals([
  'AGE_60_OR_OVER',
  'HIRED_AT_65_OR_OVER',
  'REPRESENTATIVE_OR_EXECUTIVE',
  'REPRESENTATIVE_RELATIVE',
  'SHORT_PART_TIME',
  'PART_TIME_UNDER_60_HOURS',
  'EXEMPT_FOREIGNER',
  'OTHER',
])

/** 보험 하나의 가입 여부입니다. 가입하지 않으면 제외 사유가 있어야 합니다. */
export const EnrollmentSchema = Schema.Struct({
  enrolled: Schema.Boolean,
  exclusionReason: Schema.optionalKey(ExclusionReasonSchema),
})

const terms = {
  nps: EnrollmentSchema,
  nhis: EnrollmentSchema,
  ei: EnrollmentSchema,
  iais: EnrollmentSchema,
  /** 판정에 쓰는 주 소정근로시간입니다. 없으면 그날의 근로계약에서 읽습니다. */
  weeklyWorkHours: Schema.optionalKey(Schema.Number.check(Schema.isGreaterThanOrEqualTo(0))),
  isRepresentativeOrExecutive: Schema.Boolean,
  isRepresentativeRelative: Schema.Boolean,
}

/** `PUT /employees/{id}/social-insurance` 본문입니다. `effectiveFrom`부터 적용하고, 같은 날짜의 설정은 덮어씁니다. */
export const SocialInsuranceSettingInput = Schema.Struct({ effectiveFrom: CalendarDate, ...terms })

/** {@link SocialInsuranceSettingInput}의 타입입니다. */
export type SocialInsuranceSettingInput = typeof SocialInsuranceSettingInput.Type

/** 이력 한 건입니다. */
export type SocialInsuranceSettingEntry = SocialInsuranceSettingInput

/** 판정과 다르게 저장한 보험입니다. 저장을 막지 않습니다. */
export const SocialInsuranceWarning = Schema.Struct({
  code: Schema.Literal('ELIGIBILITY_MISMATCH'),
  insurance: Schema.Literals(['nps', 'nhis', 'ei', 'iais']),
})

/** 기준일에 적용되는 4대보험 설정입니다. `recommended`는 같은 날의 자격 판정입니다. */
export const SocialInsuranceSetting = Schema.Struct({
  employeeId: EmployeeId,
  effectiveFrom: CalendarDate,
  ...terms,
  recommended: Schema.Struct({
    nps: EnrollmentSchema,
    nhis: EnrollmentSchema,
    ei: EnrollmentSchema,
    iais: EnrollmentSchema,
  }),
  warnings: Schema.Array(SocialInsuranceWarning),
  /** 직원의 설정 이력 전체의 버전입니다. 다음 `PUT`의 `If-Match`로 보냅니다. */
  version: Schema.Int,
  updatedAt: Schema.String,
})

/** {@link SocialInsuranceSetting}의 타입입니다. */
export type SocialInsuranceSetting = typeof SocialInsuranceSetting.Type

/** 직원 한 명의 4대보험 설정 이력입니다. ID는 직원 ID와 같습니다. */
export interface SocialInsuranceSettingRecord {
  id: Id<'employee'>
  companyId: Id<'company'>
  /** `effectiveFrom` 오름차순입니다. */
  entries: ReadonlyArray<SocialInsuranceSettingEntry>
  version: number
  updatedAt: string
}

/** 4대보험 설정 저장소입니다. */
export class SocialInsuranceSettingRepository extends Context.Service<
  SocialInsuranceSettingRepository,
  TenantTable<SocialInsuranceSettingRecord>
>()('semu/hr/SocialInsuranceSettingRepository') {
  /** `hr_social_insurance_settings` 표에 둡니다. */
  static readonly layer = (seed: ReadonlyArray<SocialInsuranceSettingRecord> = []) =>
    Layer.effect(
      SocialInsuranceSettingRepository,
      makeTenantTable<SocialInsuranceSettingRecord>('hr_social_insurance_settings', seed),
    )

  /** `seed`로 시작해 프로세스 메모리에 둡니다. */
  static readonly layerMemory = (seed: ReadonlyArray<SocialInsuranceSettingRecord> = []) =>
    SocialInsuranceSettingRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}

/** 기준일에 적용되는 4대보험 설정이 없습니다. */
export class SocialInsuranceSettingNotFound extends HttpApiError.Problem<SocialInsuranceSettingNotFound>()(
  'SocialInsuranceSettingNotFound',
  {
    type: problemType('SOCIAL_INSURANCE_SETTING_NOT_FOUND'),
    status: 404,
    title: 'Social insurance settings not found',
  },
  { code: Schema.tag('SOCIAL_INSURANCE_SETTING_NOT_FOUND') },
) {}

/**
 * 4대보험 설정이 규칙에 맞지 않습니다. 가입하지 않는데 제외 사유가 없으면 `REQUIRED`, 가입하는데 제외 사유가 있으면
 * `NOT_APPLICABLE`입니다(`field`는 `nps.exclusionReason` 꼴).
 */
export class SocialInsuranceSettingInvalid extends HttpApiError.Problem<SocialInsuranceSettingInvalid>()(
  'SocialInsuranceSettingInvalid',
  {
    type: problemType('SOCIAL_INSURANCE_SETTING_INVALID'),
    status: 422,
    title: 'Social insurance settings violate a rule',
  },
  { code: Schema.tag('SOCIAL_INSURANCE_SETTING_INVALID'), violations: Violations },
) {}
