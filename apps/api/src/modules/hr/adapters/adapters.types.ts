/** Delivery channel for HR notifications. */
export type NotificationChannel = 'email' | 'alimtalk'

/** Message templates the HR domain sends; each maps to a pre-approved 알림톡 or email template. */
export type NotificationTemplate =
  | 'e_sign_request'
  | 'e_sign_completed'
  | 'e_sign_expired'
  | 'e_sign_completed_copy'
  | 'certificate_issued'

/** A file attached to an email. */
export interface NotificationAttachment {
  name: string
  mimeType: string
  data: Uint8Array
}

/** One message to one recipient. */
export interface NotificationMessage {
  channel: NotificationChannel
  /** Email address or phone number, depending on the channel. */
  to: string
  template: NotificationTemplate
  /** Template variables such as `company_name`, `signing_url` and `due_date`. */
  vars: Record<string, string>
  attachments?: NotificationAttachment[]
}

/** The outcome of a send attempt; synchronous failures turn requests into `send_failed`. */
export type NotificationResult = { ok: true; messageId: string } | { ok: false; error: string }

/** Sends emails and 카카오 알림톡 messages. */
export interface NotificationAdapter {
  /** Sends a message, resolving with the provider's verdict instead of throwing. */
  send(message: NotificationMessage): Promise<NotificationResult>
}

/** A block of text in a rendered document. */
export interface PdfSection {
  heading: string
  lines: string[]
}

/** Everything needed to render an e-sign or certificate PDF. */
export interface PdfDocumentInput {
  title: string
  sections: PdfSection[]
  /** Seal and signature images to stamp, already loaded from storage. */
  images: Uint8Array[]
  /** Audit trail lines appended as the last page of signed documents. */
  auditTrail: string[]
}

/** Renders HR documents to PDF bytes. */
export interface PdfRenderer {
  /** Renders a document; the same input always yields the same bytes. */
  render(input: PdfDocumentInput): Promise<Uint8Array>
}

/** What the signer typed on the verification screen. */
export interface IdentityClaim {
  name?: string | undefined
  birth_date?: string | undefined
}

/** What the server knows about the expected signer. */
export interface IdentityExpectation {
  name: string
  birthDate: string | null
}

/** Confirms that the person holding a signing link is the intended recipient. */
export interface IdentityVerifier {
  /** Resolves `true` when the claim matches the expected person. */
  verify(expected: IdentityExpectation, claim: IdentityClaim): Promise<boolean>
}

/** The external effects the HR domain depends on. */
export interface HrAdapters {
  notifier: NotificationAdapter
  pdfRenderer: PdfRenderer
  identityVerifier: IdentityVerifier
}
