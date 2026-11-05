import { createHash } from 'node:crypto'
import type {
  IdentityVerifier,
  NotificationAdapter,
  NotificationMessage,
  NotificationResult,
  PdfDocumentInput,
  PdfRenderer,
} from './adapters.types'

/** Recipients in this domain fail synchronously in the fake notifier, so tests can reach `send_failed`. */
export const FAKE_FAILING_DOMAIN = '@fail.invalid'

/** A {@linkcode NotificationAdapter} that records messages instead of sending them. */
export interface FakeNotificationAdapter extends NotificationAdapter {
  /** Every message accepted, in order. */
  readonly outbox: NotificationMessage[]
}

/**
 * Creates a notifier that keeps messages in memory.
 *
 * Messages to an address ending in {@linkcode FAKE_FAILING_DOMAIN} fail; all others succeed with a sequential ID.
 */
export function createFakeNotificationAdapter(): FakeNotificationAdapter {
  const outbox: NotificationMessage[] = []
  return {
    outbox,
    send(message): Promise<NotificationResult> {
      if (message.to.endsWith(FAKE_FAILING_DOMAIN)) return Promise.resolve({ ok: false, error: 'Recipient rejected by provider.' })
      outbox.push(message)
      return Promise.resolve({ ok: true, messageId: `fake-${outbox.length}` })
    },
  }
}

/**
 * Creates a renderer that writes a small valid PDF listing the input text.
 *
 * Non-ASCII text cannot be drawn without embedded fonts, so the full input is
 * also kept as base64 JSON in a `% hr-data:` comment line for inspection.
 */
export function createFakePdfRenderer(): PdfRenderer {
  return {
    render(input): Promise<Uint8Array> {
      return Promise.resolve(buildPdf(input))
    },
  }
}

/** Creates a verifier that compares the claimed name and, when known, the birth date. */
export function createFakeIdentityVerifier(): IdentityVerifier {
  return {
    verify(expected, claim): Promise<boolean> {
      const nameMatches = (claim.name ?? '').trim() === expected.name.trim()
      const birthMatches = expected.birthDate === null || claim.birth_date === expected.birthDate
      return Promise.resolve(nameMatches && birthMatches)
    },
  }
}

function buildPdf(input: PdfDocumentInput): Uint8Array {
  const lines = [input.title, ...input.sections.flatMap((section) => [section.heading, ...section.lines]), ...input.auditTrail]
  const text = lines.map((line, index) => `BT /F1 10 Tf 40 ${800 - index * 14} Td (${asciiEscape(line)}) Tj ET`).join('\n')
  const imageDigests = input.images.map((image) => createHash('sha256').update(image).digest('hex').slice(0, 16))
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(text, 'latin1')} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  const data = Buffer.from(JSON.stringify({ ...input, images: imageDigests }), 'utf8').toString('base64')
  let body = `%PDF-1.4\n% hr-data:${data}\n`
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, 'latin1'))
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(body, 'latin1')
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new Uint8Array(Buffer.from(body, 'latin1'))
}

function asciiEscape(value: string): string {
  return [...value]
    .map((char) => {
      const code = char.codePointAt(0) ?? 63
      if (char === '(' || char === ')' || char === '\\') return `\\${char}`
      return code >= 32 && code < 127 ? char : '?'
    })
    .join('')
}
