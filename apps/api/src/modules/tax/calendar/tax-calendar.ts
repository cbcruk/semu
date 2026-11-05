import { Context, Effect, Layer, Option, Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import { addDays } from '../../../shared/time/calendar.ts'
import { problemType } from '../../../shared/problem/problem.ts'
import type { Actor } from '../../identity-access/actor.types.ts'
import { FilingId, FilingKind, FilingStatus, TaxType } from '../filings/filing.ts'
import { FilingRepository } from '../filings/filing-repository.ts'
import { resolveFilingObligations } from './filing-obligations.ts'
import { PublicHolidays } from './public-holidays.ts'
import { TaxProfiles } from './tax-profiles.ts'

/** 세무 달력의 한 줄입니다. 계산한 신고 의무와, 있으면 그 신고 건입니다. */
export const TaxCalendarEntry = Schema.Struct({
  taxType: TaxType,
  kind: FilingKind,
  periodKey: Schema.String,
  periodStart: Schema.String,
  periodEnd: Schema.String,
  statutoryDue: Schema.NullOr(Schema.String),
  dueDate: Schema.NullOr(Schema.String),
  paymentDue: Schema.String,
  /** 이 의무의 신고 건입니다. 일정 배치가 아직 만들지 않았으면 `null`입니다. */
  filingId: Schema.NullOr(FilingId),
  filingStatus: Schema.NullOr(FilingStatus),
})

export type TaxCalendarEntry = typeof TaxCalendarEntry.Type

/** 세무 설정이 없는 회사입니다. 세무 기장을 시작하면 만들어집니다. */
export class TaxProfileNotFound extends HttpApiError.Problem<TaxProfileNotFound>()(
  'TaxProfileNotFound',
  { type: problemType('TAX_PROFILE_NOT_FOUND'), status: 404, title: 'Tax profile not found' },
  { code: Schema.tag('TAX_PROFILE_NOT_FOUND') },
) {}

/** 한 해의 세무 일정입니다. 저장하지 않고 회사 세무 설정과 공휴일표로 그때 계산합니다. */
export class TaxCalendar extends Context.Service<
  TaxCalendar,
  {
    /** 납부 기한이 그 해 안인 신고 의무를 기한 순으로 돌려줍니다. */
    year(actor: Actor, year: number): Effect.Effect<ReadonlyArray<TaxCalendarEntry>, TaxProfileNotFound>
  }
>()('semu/tax/TaxCalendar') {
  static readonly layer = Layer.effect(
    TaxCalendar,
    Effect.gen(function* () {
      const profiles = yield* TaxProfiles
      const holidays = yield* PublicHolidays
      const repository = yield* FilingRepository

      const year = Effect.fn('TaxCalendar.year')(function* (actor: Actor, year: number) {
        const profile = yield* profiles
          .get(actor.companyId)
          .pipe(
            Effect.flatMap(
              Option.match({ onNone: () => Effect.fail(new TaxProfileNotFound({})), onSome: Effect.succeed }),
            ),
          )
        const from = `${year}-01-01`
        const to = `${year}-12-31`
        const holidaySet = yield* holidays.between(addDays(from, -31), addDays(to, 31))
        const obligations = resolveFilingObligations({ profile, from, to, holidays: holidaySet })
        const filings = yield* repository.list(actor.companyId)
        const latest = new Map<string, (typeof filings)[number]>()
        for (const filing of filings) {
          const key = `${filing.taxType}:${filing.kind}:${filing.periodKey}`
          const current = latest.get(key)
          if (current === undefined || filing.revision > current.revision) latest.set(key, filing)
        }
        return obligations.map((obligation) => {
          const filing = latest.get(`${obligation.taxType}:${obligation.kind}:${obligation.periodKey}`)
          return { ...obligation, filingId: filing?.id ?? null, filingStatus: filing?.status ?? null }
        })
      })

      return TaxCalendar.of({ year })
    }),
  )
}
