import type { AppDeps, DomainRoutes } from '../../app.types'
import { platformAccountRoutes } from './platform.account-routes'
import { platformCompanyRoutes } from './platform.company-routes'
import { resolvePlatformDeps } from './platform-deps'
import { platformPublicRoutes } from './platform.public-routes'

/** Builds the platform domain's routers, filling adapters the caller left out with deterministic fakes. */
export function platformRoutes(appDeps: AppDeps): DomainRoutes {
  const deps = resolvePlatformDeps(appDeps)
  return {
    public: platformPublicRoutes(deps),
    account: platformAccountRoutes(deps),
    company: platformCompanyRoutes(deps),
  }
}
