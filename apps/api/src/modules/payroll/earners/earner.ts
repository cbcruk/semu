import { Schema } from 'effect'
import { IdSchema } from '../../../shared/ids/id-schema.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { EarnerIdentityType } from './earner-identity.types.ts'

/**
 * 소득자 명부의 소득자 한 명입니다. 직원이 아닌 일용·사업·기타소득자를 회사마다 둡니다.
 *
 * 신원번호 원문은 `PersonalDataCipher`(`earnerRegistrationNumber`)로 암호화해서만 두고, 중복은 HMAC 해시로 찾습니다.
 */
export interface EarnerRecord {
  id: Id<'earner'>
  companyId: Id<'company'>
  name: string
  identityType: EarnerIdentityType
  registrationNumberEncrypted: string
  registrationNumberHash: string
  registrationNumberMasked: string
  /** 대장 행 사본의 기본 수신 주소입니다. */
  email: string | null
  /** 대장 행 사본의 기본 부서 이름입니다. */
  departmentName: string | null
  version: number
  createdAt: string
  updatedAt: string
}

const IdentityTypeSchema = Schema.Literals(['RESIDENT', 'ALIEN', 'PASSPORT'])
const EmailAddress = Schema.String.pipe(Schema.check(Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)))
const NonEmpty = Schema.String.pipe(Schema.check(Schema.isMinLength(1)))

/** 소득자 응답입니다. 신원번호는 가린 값(`900101-1******`, 여권은 끝 3자리)만 싣습니다. */
export const Earner = Schema.Struct({
  id: IdSchema('earner'),
  name: Schema.String,
  identityType: IdentityTypeSchema,
  registrationNumberMasked: Schema.String,
  email: Schema.NullOr(Schema.String),
  departmentName: Schema.NullOr(Schema.String),
  version: Schema.Int,
  createdAt: Schema.String,
  updatedAt: Schema.String,
})

/**
 * `POST /earners` 본문입니다. `registrationNumber`는 `identityType`의 원문입니다(등록번호는 하이픈 있어도 없어도 됨).
 */
export const CreateEarner = Schema.Struct({
  name: NonEmpty,
  identityType: IdentityTypeSchema,
  registrationNumber: NonEmpty,
  email: Schema.optionalKey(EmailAddress),
  departmentName: Schema.optionalKey(NonEmpty),
})

/**
 * `PATCH /earners/{earnerId}` 본문입니다. `identityType`을 바꾸면 `registrationNumber`도 함께 줘야 합니다.
 * `email`·`departmentName`은 `null`로 지웁니다. 이미 만든 대장 행의 사본은 `:recalculate` 때 다시 복사됩니다.
 */
export const UpdateEarner = Schema.Struct({
  name: Schema.optionalKey(NonEmpty),
  identityType: Schema.optionalKey(IdentityTypeSchema),
  registrationNumber: Schema.optionalKey(NonEmpty),
  email: Schema.optionalKey(Schema.NullOr(EmailAddress)),
  departmentName: Schema.optionalKey(Schema.NullOr(NonEmpty)),
})

/** 레코드를 응답으로 바꿉니다. 암호문과 해시는 빼냅니다. */
export function earnerResponse(record: EarnerRecord): typeof Earner.Type {
  return {
    id: record.id,
    name: record.name,
    identityType: record.identityType,
    registrationNumberMasked: record.registrationNumberMasked,
    email: record.email,
    departmentName: record.departmentName,
    version: record.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}
