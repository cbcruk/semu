import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import {
  EntitlementRequired,
  PermissionDenied,
  TermsReagreementRequired,
  VersionMismatch,
} from '../../../shared/problem/problem.ts'
import { Authentication } from '../../identity-access/authentication.ts'
import { TaxSetting, TaxSettingInvalid, TaxSettingPatch } from './tax-setting.ts'

const WithEtag = HttpApiSchema.WithHeaders(TaxSetting, { etag: Schema.String })
const ACCESS_ERRORS = [PermissionDenied, EntitlementRequired, TermsReagreementRequired] as const

/** 회사 세무 설정(결산월·원천세 주기·과세 유형·예정신고 판정 입력·카드 과세 비율)입니다. 회사마다 한 건인 싱글턴 리소스입니다. */
export class TaxSettingsApi extends HttpApiGroup.make('tax-settings')
  .add(HttpApiEndpoint.get('get', '/tax-settings', { success: WithEtag, error: ACCESS_ERRORS }))
  .add(
    HttpApiEndpoint.patch('update', '/tax-settings', {
      headers: { 'if-match': Schema.optionalKey(Schema.String) },
      payload: TaxSettingPatch,
      success: WithEtag,
      error: [...ACCESS_ERRORS, VersionMismatch, TaxSettingInvalid],
    }),
  )
  .middleware(Authentication) {}
