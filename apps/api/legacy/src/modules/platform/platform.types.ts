import type { AppDeps } from '../../app.types'

/** {@linkcode AppDeps} with every platform adapter resolved to a concrete implementation. */
export type PlatformDeps = AppDeps &
  Required<Pick<AppDeps, 'scraping' | 'scrapResultSink' | 'messenger' | 'billing' | 'socialLogin' | 'businessStatus' | 'assistant'>>

/** A company summary as embedded in `GET /api/user/me/`. */
export interface MeCompany {
  id: string
  sf_company_id: string
  name: string
  tax_plan: 'taxation' | null
  is_system_admin: boolean
}
