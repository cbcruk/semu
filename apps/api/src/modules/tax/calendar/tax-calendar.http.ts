import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { authorize } from '../../identity-access/authorization.ts'
import { TaxCalendar } from './tax-calendar.ts'

/** 세무 일정 핸들러입니다. 신고 건과 같은 요건(세무 기장·약관)을 봅니다. */
export const TaxCalendarHttpLive = HttpApiBuilder.group(
  Api,
  'taxCalendar',
  Effect.fn(function* (handlers) {
    const calendar = yield* TaxCalendar

    return handlers.handleAll({
      get: ({ query }) =>
        authorize({ permission: 'filing:read', plans: ['TAXATION'], requiresTerms: true }).pipe(
          Effect.flatMap((actor) => calendar.year(actor, query.year)),
          Effect.map((items) => ({ items })),
        ),
    })
  }),
)
