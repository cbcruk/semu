import type { AppDeps } from '../../../app.types'
import type { HrAdapters } from './adapters.types'
import { createFakeIdentityVerifier, createFakeNotificationAdapter, createFakePdfRenderer } from './fake-adapters'

/**
 * Picks the HR adapters from the app dependencies, falling back to deterministic fakes.
 *
 * The fakes are created once per call, so each app instance gets its own outbox.
 */
export function resolveHrAdapters(deps: Pick<AppDeps, 'notifier' | 'pdfRenderer' | 'identityVerifier'>): HrAdapters {
  return {
    notifier: deps.notifier ?? createFakeNotificationAdapter(),
    pdfRenderer: deps.pdfRenderer ?? createFakePdfRenderer(),
    identityVerifier: deps.identityVerifier ?? createFakeIdentityVerifier(),
  }
}
