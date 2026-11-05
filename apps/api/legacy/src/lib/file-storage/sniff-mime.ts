import type { AllowedMimeType } from './file-storage.types'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const ZIP_SCAN_BYTES = 4096

/**
 * Detects an allowed MIME type from file contents rather than the client's claim.
 *
 * Plain ZIP archives are rejected; a ZIP is only accepted as XLSX when it
 * carries an OOXML part name near the start and the file name ends in `.xlsx`.
 *
 * @returns The detected type, or `null` when the content is not allowed.
 */
export function sniffMimeType(bytes: Uint8Array, fileName: string): AllowedMimeType | null {
  const name = fileName.toLowerCase()
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, ZIP_SCAN_BYTES))
    const isOoxml = head.includes('[Content_Types].xml') || head.includes('xl/')
    return isOoxml && name.endsWith('.xlsx') ? XLSX_MIME : null
  }
  if (name.endsWith('.csv') && isUtf8Text(bytes)) return 'text/csv'
  return null
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte)
}

function isUtf8Text(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return true
  } catch {
    return false
  }
}
