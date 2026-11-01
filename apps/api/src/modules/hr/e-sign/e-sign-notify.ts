import type { NotificationMessage, NotificationResult } from '../adapters/adapters.types'
import type { HrContext } from '../shared/hr-context.types'
import { listCompanyAdminEmails, listNotiRecipients } from './e-sign-settings.repository'
import { logNotification } from './e-sign-requests.repository'

/**
 * Sends one notification and records the attempt in `hr_notifications`.
 *
 * Provider exceptions are turned into a failed result, so callers can move the request to `send_failed`.
 */
export async function sendLogged(
  context: HrContext,
  companyId: string,
  source: { type: 'e_sign_request' | 'certificate'; id: number },
  message: NotificationMessage,
): Promise<NotificationResult> {
  const result = await context.adapters.notifier.send(message).catch((error: unknown): NotificationResult => ({ ok: false, error: String(error) }))
  logNotification(context.deps.db, {
    companyId,
    channel: message.channel,
    template: message.template,
    recipient: message.to,
    ok: result.ok,
    error: result.ok ? null : result.error,
    sourceType: source.type,
    sourceId: source.id,
    now: context.deps.clock.now(),
  })
  return result
}

/**
 * Tells the company's notification recipients about a finished or expired request.
 *
 * Recipients get 알림톡 at their phone (rule R26). When none are configured
 * the company's admin members are emailed instead, standing in for the
 * representative contact that the platform domain owns.
 */
export async function notifyStaff(
  context: HrContext,
  companyId: string,
  requestId: number,
  template: 'e_sign_completed' | 'e_sign_expired',
  vars: Record<string, string>,
): Promise<void> {
  const recipients = listNotiRecipients(context.deps.db, companyId)
  const source = { type: 'e_sign_request' as const, id: requestId }
  if (recipients.length > 0) {
    for (const recipient of recipients) await sendLogged(context, companyId, source, { channel: 'alimtalk', to: recipient.phone, template, vars })
    return
  }
  for (const email of listCompanyAdminEmails(context.deps.db, companyId)) await sendLogged(context, companyId, source, { channel: 'email', to: email, template, vars })
}
