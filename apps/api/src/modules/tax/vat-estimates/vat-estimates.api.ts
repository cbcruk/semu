import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { EntitlementRequired, PermissionDenied, TermsReagreementRequired } from '../../../shared/problem/problem.ts'
import { Authentication } from '../../identity-access/authentication.ts'
import { CalendarDate } from '../../../shared/time/date-schemas.ts'
import { VatEstimateResponse, VatTrendResponse } from './vat-estimates.ts'

const accessErrors = [PermissionDenied, EntitlementRequired, TermsReagreementRequired]

/** 예상 부가세와 반기별 부가세 추이입니다. 증빙으로 그때 계산하고 저장하지 않습니다. */
export class VatEstimatesApi extends HttpApiGroup.make('vatEstimates')
  .add(
    HttpApiEndpoint.get('current', '/current', {
      query: Schema.Struct({
        /** 이 날짜가 속한 기간을 이 날짜까지의 증빙으로 계산합니다. 기본은 회사 시간대 오늘입니다. */
        on: Schema.optionalKey(CalendarDate),
      }),
      success: VatEstimateResponse,
      error: accessErrors,
    }),
    HttpApiEndpoint.get('trend', '/', {
      query: Schema.Struct({
        /** 올해를 포함해 몇 해를 볼지입니다. 1–5, 기본 3입니다. */
        years: Schema.optionalKey(
          Schema.NumberFromString.pipe(Schema.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 5 }))),
        ),
      }),
      success: VatTrendResponse,
      error: accessErrors,
    }),
  )
  .middleware(Authentication)
  .prefix('/vat-estimates') {}
