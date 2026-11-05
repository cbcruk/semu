import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { EntitlementRequired, PermissionDenied, TermsReagreementRequired } from '../../../shared/problem/problem.ts'
import { Authentication } from '../../identity-access/authentication.ts'
import { TaxCalendarEntry, TaxProfileNotFound } from './tax-calendar.ts'

/** 한 해의 세무 일정입니다. 회사 세무 설정과 공휴일표로 계산하고, 만들어진 신고 건을 함께 줍니다. */
export class TaxCalendarApi extends HttpApiGroup.make('taxCalendar')
  .add(
    HttpApiEndpoint.get('get', '/tax-calendar', {
      query: Schema.Struct({
        /** 납부 기한 기준 연도입니다. */
        year: Schema.NumberFromString.pipe(
          Schema.check(Schema.isInt(), Schema.isBetween({ minimum: 2000, maximum: 2100 })),
        ),
      }),
      success: Schema.Struct({ items: Schema.Array(TaxCalendarEntry) }),
      error: [PermissionDenied, EntitlementRequired, TermsReagreementRequired, TaxProfileNotFound],
    }),
  )
  .middleware(Authentication) {}
