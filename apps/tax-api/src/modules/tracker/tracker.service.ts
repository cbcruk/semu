import type { ServiceDeps } from '../../app.types'
import { decide } from '../access/access'
import type { AccessContext } from '../access/access.types'
import { TAX_TYPE_MENU_CODE, TAX_TYPES } from '../access/menu-codes'
import { listOpenFilings } from '../filings/filings.repository'
import { isOverdue } from '../filings/filings.serializer'
import { ctaPathOf } from '../filings/filings.utils'
import { processStepOf } from '../filings/process-step'

/** Lists in-progress filings with their legacy step, for the home progress tracker. */
export function listTracker(deps: ServiceDeps, companyId: string, access: AccessContext): Record<string, unknown>[] {
  const taxTypes = TAX_TYPES.filter((taxType) => decide(access, TAX_TYPE_MENU_CODE[taxType]).ok)
  const today = deps.clock.today()
  return listOpenFilings(deps.db, companyId, taxTypes).map((filing) => {
    const step = processStepOf(filing.tax_type, filing.status)
    return {
      filing_id: filing.id,
      tax_type: filing.tax_type,
      year: filing.year,
      quarter: filing.quarter,
      step: step.step,
      step_index: step.index,
      step_count: step.count,
      due_date: filing.due_date,
      payment_due: filing.payment_due,
      is_overdue: isOverdue(filing, today),
      cta_path: ctaPathOf(filing.tax_type),
    }
  })
}
