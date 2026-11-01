import { Hono } from 'hono'
import type { AppDeps, AppEnv } from '../../../app.types'
import { yearEndPeriod } from './misc.utils'

/** Routes outside any company, such as the year-end settlement schedule. */
export function miscAccountRoutes(deps: AppDeps): Hono<AppEnv> {
  return new Hono<AppEnv>().get('/api/bk-works/bk-schedules/current_year_end', (c) => c.json(yearEndPeriod(deps.clock.today())))
}
