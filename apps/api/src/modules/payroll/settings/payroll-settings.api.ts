import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { Authentication } from '../../identity-access/authentication.ts'
import { VersionMismatch } from '../../../shared/problem/problem.ts'
import { ACCESS_ERRORS } from '../payroll-problems.ts'
import { PayrollSetting, PayrollSettingPatch } from './payroll-setting.ts'

const WithEtag = HttpApiSchema.WithHeaders(PayrollSetting, { etag: Schema.String })

/** 회사 급여 설정(급여 지급 조건·공제 방식·가산수당 배수·운영 방식)입니다. 회사마다 한 건인 싱글턴 리소스입니다. */
export class PayrollSettingsGroup extends HttpApiGroup.make('payroll-settings')
  .add(HttpApiEndpoint.get('get', '/payroll-settings', { success: WithEtag, error: ACCESS_ERRORS }))
  .add(
    HttpApiEndpoint.patch('update', '/payroll-settings', {
      headers: { 'if-match': Schema.optionalKey(Schema.String) },
      payload: PayrollSettingPatch,
      success: WithEtag,
      error: [...ACCESS_ERRORS, VersionMismatch],
    }),
  )
  .middleware(Authentication) {}
