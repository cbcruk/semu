import { Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import { IdSchema } from '../../../shared/ids/id-schema.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { problemType } from '../../../shared/problem/problem.ts'
import type { SealedSecret } from '../credentials/credential-vault.ts'
import { AuthMethodSchema, InstitutionTypeSchema } from '../institutions/institution.ts'
import type { AuthMethod, InstitutionType } from '../institutions/institution.ts'
import type { LastScrapOutcome } from './scrap-retry.ts'

/** 기관 연동 ID입니다. 예: `int_01J...` */
export const IntegrationId = IdSchema('integration')

/** 공동인증서 ID입니다. 예: `crt_01J...` */
export const CertificateId = IdSchema('certificate')

/** 인증서 상태 스키마입니다. */
export const CertificateStatusSchema = Schema.Literals(['ACTIVE', 'EXPIRED', 'INACTIVE', 'UNREGISTERED'])

/** 마지막 수집 결과입니다. */
export const LastScrap = Schema.Struct({
  status: Schema.Literals(['SUCCEEDED', 'FAILED']),
  /** 실패 코드입니다. 예: `INVALID_CREDENTIAL`, `INSTITUTION_UNAVAILABLE` */
  code: Schema.optionalKey(Schema.String),
  isRetryable: Schema.Boolean,
  finishedAt: Schema.String,
})

/** 마지막 수집 결과입니다. */
export type LastScrap = typeof LastScrap.Type

/** 연동 아래 항목(카드·계좌·매장·쇼핑몰 SCM)입니다. */
export const IntegrationItem = Schema.Struct({
  /** 기관 쪽 식별자입니다. 경로의 `{itemKey}`입니다. */
  key: Schema.String,
  kind: Schema.Literals(['CARD', 'ACCOUNT', 'STORE', 'SCM']),
  institutionCode: Schema.String,
  name: Schema.String,
  /** 카드·계좌 번호의 끝 4자리만 보입니다. 예: `****1111` */
  numberMasked: Schema.optionalKey(Schema.String),
  isActive: Schema.Boolean,
  lastScrap: Schema.optionalKey(LastScrap),
  allowedActions: Schema.Array(Schema.Literals(['RETRY', 'ACTIVATE', 'DEACTIVATE', 'DELETE'])),
})

/** 연동 항목입니다. */
export type IntegrationItem = typeof IntegrationItem.Type

/** 연동에 걸 수 있는 동작입니다. 클라이언트는 이 목록으로 버튼을 켭니다. */
export const IntegrationAction = Schema.Literals(['SCRAP', 'RETRY', 'REPLACE_CREDENTIALS', 'DELETE'])

/**
 * 기관 연동입니다. 자격 증명 원문은 응답에 넣지 않고, 로그인 ID와 PG 공개 키만 보입니다.
 *
 * 현행 유형별 응답(`CardIntegration`, `BankIntegration`, `pgs` …)과 상태 화면(`integrationStatus`)을 한 형태로 합칩니다.
 */
export const Integration = Schema.Struct({
  id: IntegrationId,
  type: InstitutionTypeSchema,
  /** 카드사·은행·PG사·배달앱 코드입니다. 홈택스·여신협회·지로는 없습니다. */
  institutionCode: Schema.optionalKey(Schema.String),
  authMethod: AuthMethodSchema,
  isCorporate: Schema.Boolean,
  /** 기관 로그인 ID 또는 PG 상점아이디(MID)입니다. */
  accountId: Schema.optionalKey(Schema.String),
  certificateId: Schema.optionalKey(CertificateId),
  certificateStatus: Schema.optionalKey(CertificateStatusSchema),
  /** PG 연동키입니다. 비밀 키는 `********`로 가립니다. */
  keys: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  items: Schema.Array(IntegrationItem),
  /** 홈택스 인증서 연동만 세금계산서를 발급할 수 있습니다. */
  canIssueTaxInvoice: Schema.Boolean,
  /** 세무사 프로그램으로 넘길 수 있는 연동입니다. 인증서 연동은 세무신고에 못 씁니다. */
  usableForTaxFiling: Schema.Boolean,
  /** PG 쪽에 미리 등록해야 하는 대사 IP입니다. */
  ipWhitelist: Schema.optionalKey(Schema.String),
  /** `ERROR`는 인증서가 쓸 수 없거나 마지막 수집이 재시도할 수 없는 오류로 끝난 상태입니다. */
  status: Schema.Literals(['ACTIVE', 'ERROR']),
  lastScrap: Schema.optionalKey(LastScrap),
  allowedActions: Schema.Array(IntegrationAction),
  createdAt: Schema.String,
  version: Schema.Int,
})

/** 기관 연동입니다. */
export type Integration = typeof Integration.Type

/** 저장소가 가진 항목입니다. 번호 원문은 봉한 값으로만 둡니다. */
export interface IntegrationItemRecord {
  key: string
  kind: IntegrationItem['kind']
  institutionCode: string
  name: string
  numberMasked?: string
  isActive: boolean
  lastScrap?: LastScrap
}

/** 저장소가 가진 연동입니다. */
export interface IntegrationRecord {
  id: Id<'integration'>
  companyId: Id<'company'>
  type: InstitutionType
  institutionCode?: string
  authMethod: AuthMethod
  isCorporate: boolean
  accountId?: string
  certificateId?: Id<'certificate'>
  /** PG 공개 키입니다. 비밀 키는 `credential`에만 있습니다. */
  publicKeys?: Readonly<Record<string, string>>
  secretKeyNames?: ReadonlyArray<string>
  /** 봉한 자격 증명입니다. 인증서 연동은 인증서 쪽에 있으므로 없습니다. */
  credential?: SealedSecret
  items: IntegrationItemRecord[]
  canIssueTaxInvoice: boolean
  usableForTaxFiling: boolean
  ipWhitelist?: string
  lastScrap?: LastScrap
  createdAt: string
  version: number
}

const loginFields = {
  type: InstitutionTypeSchema,
  authMethod: AuthMethodSchema,
  /** 카드사·은행·PG사·배달앱 코드입니다. 인증서 연동은 카드사·은행 여럿을 한 번에 고를 수 있습니다. */
  institutionCodes: Schema.optionalKey(Schema.Array(Schema.NonEmptyString)),
  isCorporate: Schema.optionalKey(Schema.Boolean),
  accountId: Schema.optionalKey(Schema.NonEmptyString),
  password: Schema.optionalKey(Schema.NonEmptyString),
  certificateId: Schema.optionalKey(CertificateId),
  mid: Schema.optionalKey(Schema.NonEmptyString),
  keys: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
}

/** 새 연동 요청입니다. 필요한 자격 증명은 `authMethod`에 따라 다릅니다. */
export const IntegrationRegistration = Schema.Struct({
  ...loginFields,
  /** 후보 조회(`:list-candidates`)에서 고른 카드·계좌 키입니다. 배달은 기관이 알려 준 매장을 모두 등록합니다. */
  itemKeys: Schema.optionalKey(Schema.Array(Schema.String)),
})

/** 새 연동 요청입니다. */
export type IntegrationRegistration = typeof IntegrationRegistration.Type

/** 카드·계좌·매장 후보 조회 요청입니다. 등록 요청에서 `itemKeys`만 뺀 형태입니다. */
export const CandidateQuery = Schema.Struct(loginFields)

/** 후보 하나입니다. */
export const Candidate = Schema.Struct({
  institutionCode: Schema.String,
  key: Schema.String,
  name: Schema.String,
  numberMasked: Schema.optionalKey(Schema.String),
  /** 이미 등록한 항목이면 참입니다. */
  isRegistered: Schema.Boolean,
})

/** 자격 증명 교체 요청입니다. 비밀번호가 바뀌었거나 인증서를 새로 받았을 때 씁니다. */
export const CredentialReplacement = Schema.Struct({
  password: Schema.optionalKey(Schema.NonEmptyString),
  certificateId: Schema.optionalKey(CertificateId),
  keys: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
})

/** 항목 수정 요청입니다. 현행 카드번호 보정(`PUT creditcard/:id/:cardId`)과 계좌 on/off(`PATCH bank/accounts`)입니다. */
export const ItemPatch = Schema.Struct({
  isActive: Schema.optionalKey(Schema.Boolean),
  /** 카드사가 끝자리를 가려서 준 번호를 사용자가 고칩니다. */
  number: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^\d{12,19}$/))),
})

/** 연동 목록 응답입니다. 유형별 한도와 쓴 수를 함께 줍니다. */
export const IntegrationList = Schema.Struct({
  items: Schema.Array(Integration),
  limits: Schema.Array(
    Schema.Struct({
      type: InstitutionTypeSchema,
      max: Schema.Int,
      used: Schema.Int,
      unit: Schema.Literals(['ITEM', 'INTEGRATION']),
    }),
  ),
})

/** 요청한 연동이 이 회사에 없습니다. */
export class IntegrationNotFound extends HttpApiError.Problem<IntegrationNotFound>()(
  'IntegrationNotFound',
  { type: problemType('INTEGRATION_NOT_FOUND'), status: 404, title: 'Integration not found' },
  { code: Schema.tag('INTEGRATION_NOT_FOUND') },
) {}

/** 연동 항목이 없습니다. */
export class IntegrationItemNotFound extends HttpApiError.Problem<IntegrationItemNotFound>()(
  'IntegrationItemNotFound',
  { type: problemType('INTEGRATION_ITEM_NOT_FOUND'), status: 404, title: 'Integration item not found' },
  { code: Schema.tag('INTEGRATION_ITEM_NOT_FOUND') },
) {}

/** 그 기관이 받지 않는 인증 방법입니다. 지로 ID/PW, 배달 인증서, 하나·롯데·삼성 법인카드 인증서가 해당합니다. */
export class AuthMethodNotSupported extends HttpApiError.Problem<AuthMethodNotSupported>()(
  'AuthMethodNotSupported',
  { type: problemType('AUTH_METHOD_NOT_SUPPORTED'), status: 422, title: 'Institution does not accept this login' },
  { code: Schema.tag('AUTH_METHOD_NOT_SUPPORTED'), field: Schema.String },
) {}

/** 카드·계좌·PG 상점·배달 매장 한도(유형별 20개)를 넘습니다. */
export class IntegrationLimitExceeded extends HttpApiError.Problem<IntegrationLimitExceeded>()(
  'IntegrationLimitExceeded',
  { type: problemType('INTEGRATION_LIMIT_EXCEEDED'), status: 422, title: 'Too many integrations of this type' },
  { code: Schema.tag('INTEGRATION_LIMIT_EXCEEDED'), field: Schema.String, limit: Schema.Int },
) {}

/** 같은 연동이 이미 있습니다. 같은 인증 방법의 홈택스, 같은 PG사·MID, 이미 모두 등록한 매장 등입니다. */
export class IntegrationDuplicate extends HttpApiError.Problem<IntegrationDuplicate>()(
  'IntegrationDuplicate',
  { type: problemType('INTEGRATION_DUPLICATE'), status: 409, title: 'Integration already exists' },
  { code: Schema.tag('INTEGRATION_DUPLICATE'), reason: Schema.Literals(['SAME_INTEGRATION', 'NO_NEW_ITEMS']) },
) {}

/** PG사 코드, MID, 연동키가 맞지 않습니다. */
export class PgKeysInvalid extends HttpApiError.Problem<PgKeysInvalid>()(
  'PgKeysInvalid',
  { type: problemType('PG_KEYS_INVALID'), status: 422, title: 'PG keys are invalid' },
  {
    code: Schema.tag('PG_KEYS_INVALID'),
    reason: Schema.Literals(['UNKNOWN_PG_COMPANY', 'MID_NOT_SUPPORTED', 'KEY_MISSING']),
    field: Schema.String,
    missing: Schema.optionalKey(Schema.Array(Schema.String)),
  },
) {}

/** 기관이 자격 증명을 거절했습니다. 비밀번호 오류, 계정 잠김 등입니다. */
export class InstitutionCredentialRejected extends HttpApiError.Problem<InstitutionCredentialRejected>()(
  'InstitutionCredentialRejected',
  { type: problemType('INSTITUTION_CREDENTIAL_REJECTED'), status: 422, title: 'Institution rejected the credentials' },
  { code: Schema.tag('INSTITUTION_CREDENTIAL_REJECTED'), reason: Schema.String, isRetryable: Schema.Boolean },
) {}

/** 이 인증서로는 이 기관에 연동할 수 없습니다. 명의·용도가 다르거나 인증서가 쓸 수 없는 상태입니다. */
export class CertificateNotUsable extends HttpApiError.Problem<CertificateNotUsable>()(
  'CertificateNotUsable',
  { type: problemType('CERTIFICATE_NOT_USABLE'), status: 422, title: 'Certificate cannot be used here' },
  {
    code: Schema.tag('CERTIFICATE_NOT_USABLE'),
    reason: Schema.Literals(['NOT_ALLOWED_FOR_INSTITUTION', 'NOT_ACTIVE']),
    certificateStatus: Schema.optionalKey(CertificateStatusSchema),
  },
) {}
