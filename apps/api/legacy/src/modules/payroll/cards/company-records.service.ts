/**
 * Company-level payroll records: the manager memo (특이사항), Shiftee integration and desk export.
 *
 * @module
 */
import type { ServiceDeps } from '../../../app.types'
import { transaction } from '../../../db/query'
import { DomainError } from '../../../lib/domain-error'
import type { DeskExportAdapter, ShifteeAdapter } from '../adapters/payroll-adapters.types'
import { PayrollError } from '../payroll-error'
import * as repo from './cards.repository'
import { checkTransition, requireCard, transition, type CardCaller } from './cards.service'
import type { CardRow, IntegrationRow } from './cards.types'
import { segmentOf } from './cards.utils'

/** Serializes the company's manager memo; an unsaved memo is empty. */
export function managerMemoOf(deps: ServiceDeps, companyId: string): Record<string, unknown> {
  const memo = repo.findManagerMemo(deps.db, companyId)
  return { content: memo?.content ?? '', updated_by: memo?.updated_by ?? null, updated_at: memo?.updated_at ?? null }
}

/**
 * Saves the manager memo, which only agency staff write (spec 5.11).
 *
 * @throws {DomainError} `PERMISSION_DENIED` for clients.
 */
export function saveManagerMemo(deps: ServiceDeps, companyId: string, content: string, caller: CardCaller): Record<string, unknown> {
  if (caller.actor !== 'agency') throw new DomainError('PERMISSION_DENIED', 'Only agency staff can write the manager memo.')
  repo.saveManagerMemo(deps.db, companyId, content, caller.userId, deps.clock.now())
  return managerMemoOf(deps, companyId)
}

/** Serializes the Shiftee integration state: `none`, `linked` or `unlinked` (re-linking is blocked). */
export function serializeIntegration(row: IntegrationRow | undefined): Record<string, unknown> {
  return {
    provider: 'shiftee',
    status: row?.status ?? 'none',
    is_linked: row?.status === 'linked',
    can_link: row === undefined,
    external_company_id: row?.external_company_id ?? null,
    company_name: row?.company_name ?? null,
    representative_name: row?.representative_name ?? null,
    admin_email: row?.admin_email ?? null,
    linked_at: row?.linked_at ?? null,
    unlinked_at: row?.unlinked_at ?? null,
  }
}

/**
 * Creates a Shiftee company and links it.
 *
 * @throws {PayrollError} `SHIFTEE_RELINK_BLOCKED` after an earlier unlink.
 * @throws {DomainError} `CONFLICT` when already linked or when Shiftee refuses.
 */
export async function linkShiftee(
  deps: ServiceDeps,
  adapter: ShifteeAdapter,
  companyId: string,
  request: { companyName: string; representativeName: string; email: string },
  caller: CardCaller,
): Promise<IntegrationRow | undefined> {
  assertLinkable(repo.findIntegration(deps.db, companyId))
  const result = await adapter.createCompany(request)
  if (!result.ok) throw new DomainError('CONFLICT', result.error)
  return transaction(deps.db, () => {
    assertLinkable(repo.findIntegration(deps.db, companyId))
    repo.insertIntegration(
      deps.db,
      companyId,
      {
        external_company_id: result.externalCompanyId,
        company_name: request.companyName,
        representative_name: request.representativeName,
        admin_email: request.email,
        linked_by: caller.userId,
      },
      deps.clock.now(),
    )
    return repo.findIntegration(deps.db, companyId)
  })
}

/**
 * Unlinks Shiftee; the company cannot link again afterwards.
 *
 * @throws {DomainError} `NOT_FOUND` when nothing is linked.
 */
export async function unlinkShiftee(deps: ServiceDeps, adapter: ShifteeAdapter, companyId: string): Promise<IntegrationRow | undefined> {
  const current = repo.findIntegration(deps.db, companyId)
  if (current?.status !== 'linked') throw new DomainError('NOT_FOUND', 'Shiftee is not linked.')
  await adapter.unlink(current.external_company_id)
  return transaction(deps.db, () => {
    repo.unlinkIntegration(deps.db, companyId, deps.clock.now())
    return repo.findIntegration(deps.db, companyId)
  })
}

/**
 * Sends a closed card to the bookkeeping desk and marks it `exported`.
 *
 * The transition is checked before the adapter is called and run after it
 * answers, so a desk failure leaves the card unchanged.
 *
 * @throws {DomainError} `CONFLICT` when the desk refuses the export.
 */
export async function exportToDesk(
  deps: ServiceDeps,
  adapter: DeskExportAdapter,
  companyId: string,
  cardId: number,
  exportType: 'payroll_ledger' | 'journal',
  caller: CardCaller,
  expectedVersion: number,
): Promise<CardRow> {
  const card = requireCard(deps.db, companyId, cardId, 'bpo')
  checkTransition(deps.db, card, 'exportToDesk', caller, expectedVersion)
  const rows = repo.listRows(deps.db, companyId, card.id)
  const result = await adapter.export({
    companyId,
    cardId: card.id,
    exportType,
    attributionMonth: card.attribution_month,
    paymentDate: card.payment_date,
    rows: rows.map((row) => ({
      name: row.name,
      incomeType: segmentOf(row.income_type),
      grossPay: row.gross_pay,
      deductionTotal: row.deduction_total,
      netPay: row.net_pay,
      incomeTax: row.income_tax,
      localIncomeTax: row.local_income_tax,
    })),
  })
  if (!result.ok) throw new DomainError('CONFLICT', result.error)
  return transaction(deps.db, () =>
    transition(deps, requireCard(deps.db, companyId, cardId, 'bpo'), 'exportToDesk', caller, expectedVersion, { exportType, exportReference: result.reference }),
  )
}

function assertLinkable(row: IntegrationRow | undefined): void {
  if (row?.status === 'linked') throw new DomainError('CONFLICT', 'Shiftee is already linked.')
  if (row?.status === 'unlinked') throw new PayrollError('SHIFTEE_RELINK_BLOCKED', 'Shiftee cannot be linked again after it was unlinked.')
}
