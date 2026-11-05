import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { PermissionDenied } from '../../../shared/problem/problem.ts'
import { Authentication } from '../../identity-access/authentication.ts'

/** 하이픈 없는 10자리 사업자등록번호입니다. */
export const BusinessNumber = Schema.String.check(Schema.isPattern(/^\d{10}$/))

/** 국세청 기준 사업자 상태입니다. 현행 `partner/scrap/business-status`를 대신합니다. */
export const BusinessStatus = Schema.Struct({
  businessNumber: BusinessNumber,
  status: Schema.Literals(['ACTIVE', 'SUSPENDED', 'CLOSED', 'UNREGISTERED']),
  taxType: Schema.optionalKey(Schema.Literals(['GENERAL', 'SIMPLIFIED', 'TAX_EXEMPT', 'NON_PROFIT'])),
  closedOn: Schema.optionalKey(Schema.String),
})

/** 거래처·가입 확인에 쓰는 사업자 상태조회입니다. */
export class BusinessStatusesApi extends HttpApiGroup.make('businessStatuses')
  .add(
    HttpApiEndpoint.get('get', '/business-statuses/:businessNumber', {
      params: { businessNumber: BusinessNumber },
      success: BusinessStatus,
      error: PermissionDenied,
    }),
  )
  .middleware(Authentication) {}
