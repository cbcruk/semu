import type { FakeMessenger, MailMessage, SmsMessage } from './messenger.adapter'

/**
 * Creates a {@linkcode FakeMessenger} that records messages instead of sending them.
 *
 * @example Reading a verification token in a test
 * ```ts
 * import { createFakeMessenger } from './fake-messenger.adapter'
 *
 * const messenger = createFakeMessenger()
 * await messenger.sendMail({ to: 'a@example.com', template: 'signup_verification', token: 't', data: {} })
 * messenger.outbox.at(-1) // { channel: 'mail', to: 'a@example.com', token: 't', ... }
 * ```
 */
export function createFakeMessenger(): FakeMessenger {
  const outbox: FakeMessenger['outbox'] = []
  return {
    outbox,
    sendMail(message: MailMessage): Promise<void> {
      outbox.push({ channel: 'mail', ...message })
      return Promise.resolve()
    },
    sendSms(message: SmsMessage): Promise<void> {
      outbox.push({ channel: 'sms', ...message })
      return Promise.resolve()
    },
  }
}
