import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { Page, PageQueryFields } from '../../../shared/http/pagination.ts'
import { PermissionDenied, VersionMismatch } from '../../../shared/problem/problem.ts'
import { Authentication } from '../../identity-access/authentication.ts'
import { AccountTitleNotAssignable } from '../account-titles/account-title.ts'
import { AccountTitleId, EvidenceId, PartnerId } from '../common/ids.ts'
import { CalendarDate, IfMatchHeaders } from '../common/wire.ts'
import {
  BatchTargetMissing,
  ClassificationStatus,
  Evidence,
  EvidenceNotFound,
  EvidenceSide,
  EvidenceSource,
  PartnerNotFound,
  VatDeduction,
  VatDeductionNotApplicable,
} from './evidence.ts'

const FilterFields = {
  side: Schema.optionalKey(EvidenceSide),
  source: Schema.optionalKey(EvidenceSource),
  /** 작성일자 시작(포함)입니다. */
  from: Schema.optionalKey(CalendarDate),
  /** 작성일자 끝(포함)입니다. */
  to: Schema.optionalKey(CalendarDate),
  partnerId: Schema.optionalKey(PartnerId),
  search: Schema.optionalKey(Schema.String),
}

const params = { evidenceId: EvidenceId }
const success = HttpApiSchema.WithHeaders(Evidence, { etag: Schema.String })

/**
 * 매출·매입 증빙입니다. 현행 `/evidence/:side`의 두 탭을 `side` 필터 하나로 합쳤습니다.
 *
 * 증빙은 수집으로만 생기고 지우지 않습니다. 사람이 바꾸는 것은 분류·거래처·메모·공제 여부입니다.
 */
export class EvidenceApi extends HttpApiGroup.make('evidence')
  .add(
    HttpApiEndpoint.get('list', '/evidence', {
      query: Schema.Struct({
        ...PageQueryFields,
        ...FilterFields,
        classification: Schema.optionalKey(ClassificationStatus),
      }),
      success: Page(Evidence),
      error: PermissionDenied,
    }),
    HttpApiEndpoint.get('count', '/evidence::count', {
      query: Schema.Struct(FilterFields),
      success: Schema.Struct({ totalCount: Schema.Int, classifiedCount: Schema.Int, unclassifiedCount: Schema.Int }),
      error: PermissionDenied,
    }),
    HttpApiEndpoint.get('get', '/evidence/:evidenceId', {
      params,
      success,
      error: [EvidenceNotFound, PermissionDenied],
    }),
    HttpApiEndpoint.patch('update', '/evidence/:evidenceId', {
      params,
      headers: IfMatchHeaders,
      payload: Schema.Struct({
        memo: Schema.optionalKey(Schema.NullOr(Schema.String.check(Schema.isMaxLength(200)))),
        /** 매입 증빙만 받습니다. */
        vatDeduction: Schema.optionalKey(VatDeduction),
        partnerId: Schema.optionalKey(Schema.NullOr(PartnerId)),
      }),
      success,
      error: [EvidenceNotFound, VatDeductionNotApplicable, PartnerNotFound, VersionMismatch, PermissionDenied],
    }),
    HttpApiEndpoint.post('classify', '/evidence/:evidenceId::classify', {
      params,
      headers: IfMatchHeaders,
      payload: Schema.Struct({
        /** `null`이면 분류를 지웁니다. */
        accountTitleId: Schema.NullOr(AccountTitleId),
        partnerId: Schema.optionalKey(Schema.NullOr(PartnerId)),
      }),
      success,
      error: [EvidenceNotFound, AccountTitleNotAssignable, PartnerNotFound, VersionMismatch, PermissionDenied],
    }),
    HttpApiEndpoint.post('batchClassify', '/evidence::batchClassify', {
      payload: Schema.Struct({
        evidenceIds: Schema.Array(EvidenceId).check(Schema.isMinLength(1), Schema.isMaxLength(500)),
        accountTitleId: Schema.NullOr(AccountTitleId),
      }),
      success: Schema.Struct({ updatedCount: Schema.Int }),
      error: [BatchTargetMissing, AccountTitleNotAssignable, PermissionDenied],
    }),
  )
  .middleware(Authentication) {}
