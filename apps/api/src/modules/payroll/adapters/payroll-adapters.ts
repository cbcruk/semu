import type { AppDeps } from '../../../app.types'
import { resolveHrAdapters } from '../../hr/adapters/hr-adapters'
import type { PayslipAdapters } from '../cards/payslips.service'
import { createFakeDeskExportAdapter, createFakeShifteeAdapter } from './fake-payroll-adapters'
import type { PayrollAdapters } from './payroll-adapters.types'

/**
 * Picks the payroll adapters from the app dependencies, falling back to deterministic fakes.
 *
 * Payslip email and PDF rendering reuse HR's notifier and renderer, so
 * `deps.notifier` and `deps.pdfRenderer` serve both domains.
 */
export function resolvePayrollAdapters(deps: AppDeps): PayrollAdapters & PayslipAdapters {
  const hr = resolveHrAdapters(deps)
  return {
    deskExport: deps.deskExport ?? createFakeDeskExportAdapter(),
    shiftee: deps.shiftee ?? createFakeShifteeAdapter(),
    notifier: hr.notifier,
    pdfRenderer: hr.pdfRenderer,
  }
}
