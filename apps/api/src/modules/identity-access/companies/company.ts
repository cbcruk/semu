import { Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import { IdSchema } from '../../../shared/ids/id-schema.ts'
import { problemType } from '../../../shared/problem/problem.ts'

/** 회사 ID입니다. 예: `cmp_01J...` */
export const CompanyId = IdSchema('company')

/** 사업자 형태입니다. 현행 nexus `kind`(0 법인, 1 개인)를 대신합니다. */
export const BusinessType = Schema.Literals(['CORPORATION', 'INDIVIDUAL'])

/** 플랜입니다. Billing의 구독에서 파생합니다. */
export const PlanSchema = Schema.Literals(['TAXATION', 'PAYROLL'])

/** 회사를 담당하는 세무 대리인 정보입니다. */
export const CompanyAgency = Schema.Struct({
  id: IdSchema('agency'),
  name: Schema.String,
  /** `HQ`는 본사 직영입니다. 본사 담당 회사는 급여 프로모션을 봅니다. */
  kind: Schema.Literals(['HQ', 'BRANCH']),
})

/** 회사 주소입니다. 우편번호와 기본 주소는 주소 검색 결과만 받습니다. */
export const CompanyAddress = Schema.Struct({
  zipCode: Schema.String.check(Schema.isPattern(/^\d{5}$/)),
  line1: Schema.NonEmptyString,
  line2: Schema.optionalKey(Schema.String),
})

/** 대표자입니다. 회사 정보와 한 요청으로 저장합니다. */
export const Representative = Schema.Struct({
  name: Schema.NonEmptyString,
  phone: Schema.optionalKey(Schema.String),
})

/**
 * 회사(테넌트)입니다. 현행 nexus 회사와 sf 회사 설정을 하나로 합쳤습니다. `sfCompanyId`는 없습니다.
 *
 * 상호와 사업자등록번호는 가입 때 정하고 바꾸지 않습니다. 급여 지급일은 Payroll의 급여 설정이 가집니다.
 */
export const Company = Schema.Struct({
  id: CompanyId,
  name: Schema.String,
  /** 숫자 10자리입니다. 예: `1234567890` */
  businessNumber: Schema.String,
  businessType: BusinessType,
  phone: Schema.optionalKey(Schema.String),
  /** 업종(자유 입력)입니다. 지원사업 추천의 업종 코드는 따로 둡니다. */
  industry: Schema.optionalKey(Schema.String),
  address: Schema.optionalKey(CompanyAddress),
  /** 시·도 코드입니다. 주소에서 파생하며 지원사업 추천이 씁니다. */
  regionCode: Schema.optionalKey(Schema.String),
  /** 법인등록번호 13자리입니다. 법인만 있습니다. */
  corporateRegistrationNumber: Schema.optionalKey(Schema.String),
  establishedOn: Schema.optionalKey(Schema.String),
  representatives: Schema.Array(Representative),
  agency: Schema.optionalKey(CompanyAgency),
  createdAt: Schema.String,
  version: Schema.Int,
})

export type Company = typeof Company.Type

/** 회사 정보 수정 요청입니다. 보낸 필드만 바꿉니다. */
export const CompanyPatch = Schema.Struct({
  phone: Schema.optionalKey(Schema.NonEmptyString),
  industry: Schema.optionalKey(Schema.NonEmptyString),
  address: Schema.optionalKey(CompanyAddress),
  corporateRegistrationNumber: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^\d{13}$/))),
  establishedOn: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/))),
  representatives: Schema.optionalKey(Schema.Array(Representative)),
})

export type CompanyPatch = typeof CompanyPatch.Type

/** 회사 등록 요청입니다. 등록한 사용자가 회사의 소유자(관리자)가 됩니다. */
export const CompanyRegistration = Schema.Struct({
  name: Schema.NonEmptyString,
  /** 하이픈은 있어도 됩니다. 저장할 때 숫자만 남깁니다. */
  businessNumber: Schema.String,
  businessType: BusinessType,
  phone: Schema.optionalKey(Schema.NonEmptyString),
})

export type CompanyRegistration = typeof CompanyRegistration.Type

/** 요청한 회사가 없거나 행위자가 그 회사에 접근할 수 없습니다. 존재 여부를 드러내지 않도록 둘을 구분하지 않습니다. */
export class CompanyNotFound extends HttpApiError.Problem<CompanyNotFound>()(
  'CompanyNotFound',
  { type: problemType('COMPANY_NOT_FOUND'), status: 404, title: 'Company not found' },
  { code: Schema.tag('COMPANY_NOT_FOUND') },
) {}

/** 사업자등록번호 형식이나 검증 숫자가 틀렸습니다. */
export class BusinessNumberInvalid extends HttpApiError.Problem<BusinessNumberInvalid>()(
  'BusinessNumberInvalid',
  { type: problemType('BUSINESS_NUMBER_INVALID'), status: 422, title: 'Business registration number is invalid' },
  { code: Schema.tag('BUSINESS_NUMBER_INVALID') },
) {}

/** 같은 사업자등록번호로 등록된 회사가 있습니다. */
export class CompanyAlreadyRegistered extends HttpApiError.Problem<CompanyAlreadyRegistered>()(
  'CompanyAlreadyRegistered',
  { type: problemType('COMPANY_ALREADY_REGISTERED'), status: 409, title: 'Company is already registered' },
  { code: Schema.tag('COMPANY_ALREADY_REGISTERED') },
) {}
