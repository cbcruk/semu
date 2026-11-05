import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { Page, PageQueryFields } from '../../../shared/http/pagination.ts'
import { PermissionDenied, VersionMismatch } from '../../../shared/problem/problem.ts'
import { Authentication } from '../../identity-access/authentication.ts'
import { PartnerId } from '../common/ids.ts'
import { IfMatchHeaders } from '../common/wire.ts'
import { PartnerNotFound } from '../evidence/evidence.ts'
import {
  BusinessNumber,
  BusinessStatusResult,
  Partner,
  PartnerBusinessNumberDuplicate,
  PartnerBusinessNumberRequired,
  PartnerContact,
  PartnerRole,
  PartnerType,
} from './partner.ts'

const Text = (max: number) => Schema.NullOr(Schema.String.check(Schema.isMaxLength(max)))

const PartnerFields = {
  type: PartnerType,
  roles: Schema.Array(PartnerRole).check(Schema.isMinLength(1)),
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  representativeName: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(50)),
  businessNumber: Schema.optionalKey(Schema.NullOr(BusinessNumber)),
  businessType: Schema.optionalKey(Text(100)),
  businessItem: Schema.optionalKey(Text(100)),
  address: Schema.optionalKey(Text(200)),
  phoneNumber: Schema.optionalKey(Text(30)),
  memo: Schema.optionalKey(Text(500)),
  /** 계좌번호 원문은 저장할 때 암호화하고 응답에는 끝 4자리만 보입니다. */
  bankAccounts: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        bankCode: Schema.String,
        accountNumber: Schema.String.check(Schema.isMinLength(4)),
        alias: Schema.optionalKey(Text(30)),
        isPrimary: Schema.optionalKey(Schema.Boolean),
      }),
    ),
  ),
  contacts: Schema.optionalKey(Schema.Array(PartnerContact)),
}

const params = { partnerId: PartnerId }
const businessErrors = [PartnerBusinessNumberDuplicate, PartnerBusinessNumberRequired, PermissionDenied]

/** 거래처입니다. 사업자번호가 있으면 저장할 때 휴·폐업 상태를 조회하고, 같은 번호의 증빙을 이 거래처에 붙입니다. */
export class PartnersApi extends HttpApiGroup.make('partners')
  .add(
    HttpApiEndpoint.get('list', '/partners', {
      query: Schema.Struct({
        ...PageQueryFields,
        role: Schema.optionalKey(PartnerRole),
        search: Schema.optionalKey(Schema.String),
      }),
      success: Page(Partner),
      error: PermissionDenied,
    }),
    HttpApiEndpoint.post('create', '/partners', {
      payload: Schema.Struct(PartnerFields),
      success: Partner.pipe(HttpApiSchema.status(201)),
      error: businessErrors,
    }),
    HttpApiEndpoint.get('get', '/partners/:partnerId', {
      params,
      success: HttpApiSchema.WithHeaders(Partner, { etag: Schema.String }),
      error: [PartnerNotFound, PermissionDenied],
    }),
    HttpApiEndpoint.patch('update', '/partners/:partnerId', {
      params,
      headers: IfMatchHeaders,
      payload: Schema.Struct({
        ...PartnerFields,
        type: Schema.optionalKey(PartnerType),
        roles: Schema.optionalKey(PartnerFields.roles),
        name: Schema.optionalKey(PartnerFields.name),
        representativeName: Schema.optionalKey(PartnerFields.representativeName),
      }),
      success: HttpApiSchema.WithHeaders(Partner, { etag: Schema.String }),
      error: [...businessErrors, PartnerNotFound, VersionMismatch],
    }),
    HttpApiEndpoint.delete('remove', '/partners/:partnerId', {
      params,
      success: HttpApiSchema.NoContent,
      error: [PartnerNotFound, PermissionDenied],
    }),
  )
  .middleware(Authentication) {}
