import type { DeskExportAdapter, DeskExportRequest, ShifteeAdapter, ShifteeLinkRequest, ShifteeLinkResult } from './payroll-adapters.types'

/** Shiftee emails in this domain are reported as already registered by the fake adapter. */
export const FAKE_SHIFTEE_TAKEN_DOMAIN = '@shiftee-taken.invalid'

/** A {@linkcode DeskExportAdapter} that keeps every export in memory. */
export interface FakeDeskExportAdapter extends DeskExportAdapter {
  /** Every export request received, oldest first. */
  readonly exports: DeskExportRequest[]
}

/** A {@linkcode ShifteeAdapter} that keeps every link request in memory. */
export interface FakeShifteeAdapter extends ShifteeAdapter {
  /** Every company link request received, oldest first. */
  readonly links: ShifteeLinkRequest[]
  /** External company IDs that were unlinked. */
  readonly unlinked: string[]
}

/** Creates a desk export adapter that accepts every export with a sequential reference. */
export function createFakeDeskExportAdapter(): FakeDeskExportAdapter {
  const exports: DeskExportRequest[] = []
  return {
    exports,
    export(request): Promise<{ ok: true; reference: string }> {
      exports.push(request)
      return Promise.resolve({ ok: true, reference: `desk-${request.exportType}-${exports.length}` })
    },
  }
}

/**
 * Creates a Shiftee adapter that links every company with a sequential ID.
 *
 * Emails ending in {@linkcode FAKE_SHIFTEE_TAKEN_DOMAIN} fail as already registered.
 */
export function createFakeShifteeAdapter(): FakeShifteeAdapter {
  const links: ShifteeLinkRequest[] = []
  const unlinked: string[] = []
  return {
    links,
    unlinked,
    createCompany(request): Promise<ShifteeLinkResult> {
      if (request.email.endsWith(FAKE_SHIFTEE_TAKEN_DOMAIN)) return Promise.resolve({ ok: false, error: 'The email is already registered on Shiftee.' })
      links.push(request)
      return Promise.resolve({ ok: true, externalCompanyId: `shiftee-${links.length}` })
    },
    unlink(externalCompanyId): Promise<void> {
      unlinked.push(externalCompanyId)
      return Promise.resolve()
    },
  }
}
