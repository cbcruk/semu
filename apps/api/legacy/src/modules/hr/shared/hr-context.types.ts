import type { AppDeps } from '../../../app.types'
import type { HrAdapters } from '../adapters/adapters.types'

/** What every HR router receives: the app dependencies and the resolved external adapters. */
export interface HrContext {
  deps: AppDeps
  adapters: HrAdapters
}
