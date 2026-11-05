import { Schema } from 'effect'
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { AssistantApi } from './modules/assistant/assistant.api.ts'
import { BillingApi } from './modules/billing/billing.api.ts'
import { BookkeepingApi } from './modules/bookkeeping/bookkeeping.api.ts'
import { DocumentsApi } from './modules/documents/documents.api.ts'
import { HrApi } from './modules/hr/hr.api.ts'
import { IdentityAccessApi } from './modules/identity-access/identity-access.api.ts'
import { IntegrationsApi } from './modules/integrations/integrations.api.ts'
import { PayrollApi } from './modules/payroll/payroll.api.ts'
import { TaxApi } from './modules/tax/tax.api.ts'
import { RequestValidation } from './shared/problem/request-validation.ts'

/** 로드 밸런서와 로컬 개발에서 쓰는 생존 확인입니다. */
export class SystemApi extends HttpApiGroup.make('system').add(
  HttpApiEndpoint.get('health', '/health', {
    success: Schema.Struct({ status: Schema.Literal('ok') }),
  }),
) {}

/**
 * 백엔드의 HTTP 계약입니다. 모든 경로는 `/v1` 아래에 있습니다.
 *
 * 바운디드 컨텍스트마다 `<context>.api.ts`가 자기 그룹을 묶은 `HttpApi`를 내보내고, 여기서 합칩니다.
 * 요청 디코딩 실패는 `VALIDATION_FAILED` 문제(RFC 9457 Problem Details)로 응답합니다.
 * 첫 오류에서 멈추지 않고 모든 위반을 모아 한 번에 돌려줍니다.
 */
export class Api extends HttpApi.make('semu')
  .add(SystemApi)
  .addHttpApi(IdentityAccessApi)
  .addHttpApi(BillingApi)
  .addHttpApi(IntegrationsApi)
  .addHttpApi(AssistantApi)
  .addHttpApi(TaxApi)
  .addHttpApi(HrApi)
  .addHttpApi(DocumentsApi)
  .addHttpApi(PayrollApi)
  .addHttpApi(BookkeepingApi)
  .prefix('/v1')
  .middleware(RequestValidation)
  .annotate(HttpApi.ParseOptions, { errors: 'all' }) {}
