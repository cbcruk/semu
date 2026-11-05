const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

/** A cell value written to a worksheet; numbers stay numeric, everything else becomes inline text. */
export type XlsxCell = string | number | null

/**
 * Writes a single-sheet XLSX workbook with inline strings and no styles.
 *
 * The archive uses the ZIP "stored" method, so no compression library is
 * needed. Output is deterministic: entries carry a fixed 1980-01-01 timestamp.
 *
 * @example Exporting two rows
 * ```ts
 * import { writeXlsx } from './xlsx-writer'
 *
 * const bytes = writeXlsx('구성원', [['이름', '입사일'], ['홍길동', '2024-03-01']])
 * ```
 */
export function writeXlsx(sheetName: string, rows: readonly (readonly XlsxCell[])[]): Uint8Array {
  const sheetRows = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((cell, columnIndex) => {
          if (cell === null) return ''
          const ref = `${columnName(columnIndex)}${rowIndex + 1}`
          return typeof cell === 'number'
            ? `<c r="${ref}"><v>${cell}</v></c>`
            : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell)}</t></is></c>`
        })
        .join('')
      return `<row r="${rowIndex + 1}">${cells}</row>`
    })
    .join('')
  const files: [string, string][] = [
    [
      '[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    ],
    [
      '_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    ],
    [
      'xl/workbook.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ],
    [
      'xl/_rels/workbook.xml.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    ],
    [
      'xl/worksheets/sheet1.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`,
    ],
  ]
  return zipStored(files.map(([name, content]) => ({ name, data: new TextEncoder().encode(content) })))
}

/**
 * Packs files into a ZIP archive without compression.
 *
 * @example Bundling two PDFs
 * ```ts
 * import { zipStored } from './xlsx-writer'
 *
 * const zip = zipStored([{ name: 'a.pdf', data: a }, { name: 'b.pdf', data: b }])
 * ```
 */
export function zipStored(entries: readonly { name: string; data: Uint8Array }[]): Uint8Array {
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name)
    const crc = crc32(entry.data)
    const local = header(30, [
      [0, 4, 0x04034b50],
      [4, 2, 20],
      [6, 2, 0x0800],
      [8, 2, 0],
      [10, 2, 0],
      [12, 2, 0x21],
      [14, 4, crc],
      [18, 4, entry.data.length],
      [22, 4, entry.data.length],
      [26, 2, name.length],
      [28, 2, 0],
    ])
    chunks.push(local, name, entry.data)
    central.push(
      header(46, [
        [0, 4, 0x02014b50],
        [4, 2, 20],
        [6, 2, 20],
        [8, 2, 0x0800],
        [10, 2, 0],
        [12, 2, 0],
        [14, 2, 0x21],
        [16, 4, crc],
        [20, 4, entry.data.length],
        [24, 4, entry.data.length],
        [28, 2, name.length],
        [30, 2, 0],
        [32, 2, 0],
        [34, 2, 0],
        [36, 2, 0],
        [38, 4, 0],
        [42, 4, offset],
      ]),
      name,
    )
    offset += local.length + name.length + entry.data.length
  }
  const centralSize = central.reduce((total, chunk) => total + chunk.length, 0)
  const end = header(22, [
    [0, 4, 0x06054b50],
    [4, 2, 0],
    [6, 2, 0],
    [8, 2, entries.length],
    [10, 2, entries.length],
    [12, 4, centralSize],
    [16, 4, offset],
    [20, 2, 0],
  ])
  return concat([...chunks, ...central, end])
}

function header(size: number, fields: readonly [number, 2 | 4, number][]): Uint8Array {
  const bytes = new Uint8Array(size)
  const view = new DataView(bytes.buffer)
  for (const [at, width, value] of fields) {
    if (width === 2) view.setUint16(at, value, true)
    else view.setUint32(at, value >>> 0, true)
  }
  return bytes
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0))
  let at = 0
  for (const chunk of chunks) {
    result.set(chunk, at)
    at += chunk.length
  }
  return result
}

function columnName(index: number): string {
  let name = ''
  let value = index + 1
  while (value > 0) {
    const remainder = (value - 1) % 26
    name = String.fromCharCode(65 + remainder) + name
    value = Math.floor((value - 1) / 26)
  }
  return name
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char] ?? char)
}
