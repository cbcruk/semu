/**
 * Payslips of closed cards: listing, preview, PDF download and email delivery.
 *
 * Delivery reuses HR's {@linkcode NotificationAdapter} and rendering HR's
 * {@linkcode PdfRenderer}. A send marks each row `in_flight` in one
 * transaction, awaits the adapter outside it, then records `success` or
 * `fail` (spec 3.5).
 *
 * @module
 */
import type { ServiceDeps } from '../../../app.types'
import { transaction } from '../../../db/query'
import { DomainError, invalidField } from '../../../lib/domain-error'
import type { NotificationAdapter, PdfRenderer, PdfSection } from '../../hr/adapters/adapters.types'
import type { PayrollRowResult } from '../engine/engine.types'
import { formatWon } from '../engine/engine.utils'
import { isClosed } from './card-status'
import * as repo from './cards.repository'
import { requireCard, transition, type CardCaller } from './cards.service'
import type { CardRow, PayrollRowRecord, PayslipGroup, PayslipNotificationStatus, PayslipRow, WageInputData } from './cards.types'
import { incomeTypesOfGroup, isWageIncome, parseJsonColumn, payslipGroupOf, segmentOf } from './cards.utils'

/** Outcome of sending one payslip. */
export interface PayslipSendResult {
  row_id: number
  notification_status: PayslipNotificationStatus
  fail_reason: string | null
}

/** Adapters payslips need. */
export interface PayslipAdapters {
  notifier: NotificationAdapter
  pdfRenderer: PdfRenderer
}

/** Lists the payslip rows of a group with their delivery status (`미발송` when `null`). */
export function listPayslipRows(deps: ServiceDeps, card: CardRow, group: PayslipGroup): Record<string, unknown>[] {
  const payslips = repo.listPayslips(deps.db, card.id)
  return repo.listRows(deps.db, card.company_id, card.id, incomeTypesOfGroup(group)).map((row) => payslipSummary(row, payslips.get(row.id)))
}

/** Builds the preview of one payslip: amounts, work info and formulas. */
export function payslipDetail(deps: ServiceDeps, card: CardRow, row: PayrollRowRecord): Record<string, unknown> {
  const payslip = repo.listPayslips(deps.db, card.id).get(row.id)
  const result = parseJsonColumn<PayrollRowResult | null>(row.result, null)
  const formulas = parseJsonColumn<Record<string, string>>(payslip?.payment_formulas ?? null, {})
  return {
    ...payslipSummary(row, payslip),
    attribution_month: card.attribution_month,
    payment_date: row.payment_date ?? card.payment_date,
    payments: (result?.payments ?? []).map((line) => ({ code: line.code, name: line.name, amount: line.amount, formula: formulas[line.name] ?? line.formula })),
    deductions: (result?.deductions ?? []).map((line) => ({ code: line.code, name: line.name, amount: line.amount, formula: line.formula })),
    work: isWageIncome(row.income_type) ? parseJsonColumn<WageInputData>(row.input, {} as WageInputData).work : null,
    gross_pay: row.gross_pay,
    deduction_total: row.deduction_total,
    net_pay: row.net_pay,
    payment_formulas: formulas,
  }
}

/**
 * Renders the selected payslips into one PDF, one section group per person.
 *
 * @throws {DomainError} `INVALID_TRANSITION` before the card is closed.
 */
export async function renderPayslips(
  deps: ServiceDeps,
  card: CardRow,
  rowIds: readonly number[],
  group: PayslipGroup | undefined,
  companyName: string,
  renderer: PdfRenderer,
): Promise<Uint8Array> {
  assertClosed(card)
  const rows = selectPayslipRows(deps, card, rowIds, group)
  const sections = rows.flatMap((row) => payslipSections(deps, card, row))
  return renderer.render({ title: `${companyName} ${card.attribution_month} 급여명세서`, sections, images: [], auditTrail: [] })
}

/**
 * Sends the selected payslips by email.
 *
 * The card moves to `payslips_sent` on its first send. Rows without an email
 * fail with `no_email`; adapter rejections fail with the provider's message.
 *
 * @throws {DomainError} `INVALID_TRANSITION` before the card is closed.
 */
export async function sendPayslips(
  deps: ServiceDeps,
  companyId: string,
  cardId: number,
  generation: CardRow['generation'],
  rowIds: readonly number[],
  caller: CardCaller,
  companyName: string,
  adapters: PayslipAdapters,
): Promise<PayslipSendResult[]> {
  const { db, clock } = deps
  const prepared = transaction(db, () => {
    const card = requireCard(db, companyId, cardId, generation)
    assertClosed(card)
    const rows = selectPayslipRows(deps, card, rowIds, undefined)
    const payslips = repo.listPayslips(db, card.id)
    const now = clock.now()
    const updated = transition(deps, card, 'sendPayslips', caller, card.version)
    const jobs = rows.map((row) => {
      const email = payslips.get(row.id)?.email ?? row.email
      const notificationId = repo.insertNotification(db, card.id, row.id, email, caller.userId, now)
      repo.setPayslipStatus(db, card.id, row.id, 'in_flight', null, now)
      return { row, email, notificationId, sections: payslipSections(deps, card, row) }
    })
    return { card: updated, jobs }
  })
  const outcomes: { notificationId: number; rowId: number; ok: boolean; messageId: string | null; error: string | null }[] = []
  for (const job of prepared.jobs) {
    if (job.email === null || job.email === '') {
      outcomes.push({ notificationId: job.notificationId, rowId: job.row.id, ok: false, messageId: null, error: 'no_email' })
      continue
    }
    const pdf = await adapters.pdfRenderer.render({
      title: `${companyName} ${prepared.card.attribution_month} 급여명세서`,
      sections: job.sections,
      images: [],
      auditTrail: [],
    })
    const sent = await adapters.notifier.send({
      channel: 'email',
      to: job.email,
      template: 'payroll_payslip',
      vars: {
        company_name: companyName,
        employee_name: job.row.name,
        attribution_month: prepared.card.attribution_month,
        net_pay: String(job.row.net_pay),
      },
      attachments: [{ name: `급여명세서_${prepared.card.attribution_month}_${job.row.name}.pdf`, mimeType: 'application/pdf', data: pdf }],
    })
    outcomes.push(
      sent.ok
        ? { notificationId: job.notificationId, rowId: job.row.id, ok: true, messageId: sent.messageId, error: null }
        : { notificationId: job.notificationId, rowId: job.row.id, ok: false, messageId: null, error: sent.error },
    )
  }
  return transaction(db, () => {
    const now = clock.now()
    return outcomes.map((outcome) => {
      const status = outcome.ok ? 'success' : 'fail'
      repo.completeNotification(db, outcome.notificationId, status, outcome.messageId, outcome.error, now)
      repo.setPayslipStatus(db, cardId, outcome.rowId, status, outcome.error, now)
      return { row_id: outcome.rowId, notification_status: status, fail_reason: outcome.error }
    })
  })
}

/**
 * Rejects payslip delivery and download before the card is closed.
 *
 * @throws {DomainError} `INVALID_TRANSITION`.
 */
export function assertClosed(card: CardRow): void {
  if (!isClosed(card.status)) throw new DomainError('INVALID_TRANSITION', 'Payslips are available once the payroll card is approved.')
}

function selectPayslipRows(deps: ServiceDeps, card: CardRow, rowIds: readonly number[], group: PayslipGroup | undefined): PayrollRowRecord[] {
  const rows = repo.listRows(deps.db, card.company_id, card.id, group === undefined ? undefined : incomeTypesOfGroup(group))
  const wanted = new Set(rowIds)
  const selected = rows.filter((row) => wanted.has(row.id))
  if (selected.length !== wanted.size) throw invalidField('row_ids', 'Some rows are not on this payroll card.')
  return selected
}

function payslipSummary(row: PayrollRowRecord, payslip: PayslipRow | undefined): Record<string, unknown> {
  return {
    row_id: row.id,
    id: row.id,
    name: row.name,
    birth_date: row.birth_date,
    income_type: segmentOf(row.income_type),
    payslip_group: payslipGroupOf(row.income_type),
    department: row.department_name,
    email: payslip?.email ?? row.email,
    notification_status: payslip?.notification_status ?? null,
    sent_at: payslip?.sent_at ?? null,
    fail_reason: payslip?.fail_reason ?? null,
    net_pay: row.net_pay,
  }
}

function payslipSections(deps: ServiceDeps, card: CardRow, row: PayrollRowRecord): PdfSection[] {
  const detail = payslipDetail(deps, card, row) as {
    payments: { name: string; amount: number; formula: string }[]
    deductions: { name: string; amount: number }[]
    work: WageInputData['work'] | null
  }
  const sections: PdfSection[] = [
    {
      heading: `${row.name} (${row.department_name ?? '-'})`,
      lines: [`귀속연월 ${card.attribution_month}`, `지급일 ${row.payment_date ?? card.payment_date}`],
    },
    { heading: '지급 항목', lines: detail.payments.map((line) => `${line.name} ${formatWon(line.amount)}`) },
    { heading: '공제 항목', lines: detail.deductions.map((line) => `${line.name} ${formatWon(line.amount)}`) },
    {
      heading: '합계',
      lines: [`지급액 ${formatWon(row.gross_pay)}`, `공제액 ${formatWon(row.deduction_total)}`, `차인지급액 ${formatWon(row.net_pay)}`],
    },
    { heading: '계산 방법', lines: detail.payments.map((line) => `${line.name}: ${line.formula}`) },
  ]
  if (detail.work !== null) {
    sections.push({
      heading: '근무 정보',
      lines: [
        `연장 ${detail.work.overtime_hours}시간`,
        `야간 ${detail.work.night_hours}시간`,
        `휴일 ${detail.work.holiday_hours}시간`,
        `휴일연장 ${detail.work.holiday_overtime_hours}시간`,
      ],
    })
  }
  return sections
}
