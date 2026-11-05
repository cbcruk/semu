/** Mail templates the platform domain sends. */
export type MailTemplate = 'signup_verification' | 'password_reset' | 'internal_invitation' | 'share_company'

/** SMS and AlimTalk templates the platform domain sends. */
export type SmsTemplate = 'direct_contract_verification' | 'consult_received' | 'payment_notice'

/** A mail message; `token` carries the one-time secret embedded in the link. */
export interface MailMessage {
  to: string
  template: MailTemplate
  token?: string
  data: Record<string, string>
}

/** An SMS or AlimTalk message. */
export interface SmsMessage {
  to: string
  template: SmsTemplate
  data: Record<string, string>
}

/** Outbound mail and SMS channel. */
export interface Messenger {
  /** Sends a mail message. */
  sendMail(message: MailMessage): Promise<void>
  /** Sends an SMS or AlimTalk message. */
  sendSms(message: SmsMessage): Promise<void>
}

/** A {@linkcode Messenger} that keeps every message in memory for tests and local development. */
export interface FakeMessenger extends Messenger {
  /** Messages sent so far, oldest first. */
  readonly outbox: ({ channel: 'mail' } & MailMessage | { channel: 'sms' } & SmsMessage)[]
}
