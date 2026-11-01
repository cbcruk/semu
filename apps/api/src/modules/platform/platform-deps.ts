import type { AppDeps } from '../../app.types'
import { createFakeAssistantAdapter, createFakeBillingAdapter, createFakeBusinessStatusAdapter, createFakeSocialLoginAdapter } from './adapters/fake-adapters'
import { createFakeMessenger } from './adapters/fake-messenger.adapter'
import { createFakeScrapingAdapter, createNoopScrapResultSink } from './adapters/fake-scraping.adapter'
import type { PlatformDeps } from './platform.types'

/** Fills every adapter the caller left out with its deterministic fake. */
export function resolvePlatformDeps(deps: AppDeps): PlatformDeps {
  return {
    ...deps,
    scraping: deps.scraping ?? createFakeScrapingAdapter(),
    scrapResultSink: deps.scrapResultSink ?? createNoopScrapResultSink(),
    messenger: deps.messenger ?? createFakeMessenger(),
    billing: deps.billing ?? createFakeBillingAdapter(),
    socialLogin: deps.socialLogin ?? createFakeSocialLoginAdapter(),
    businessStatus: deps.businessStatus ?? createFakeBusinessStatusAdapter(),
    assistant: deps.assistant ?? createFakeAssistantAdapter(),
  }
}
