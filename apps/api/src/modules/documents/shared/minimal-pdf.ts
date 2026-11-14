/**
 * 글자만 있는 한 쪽짜리 PDF를 만듭니다. 실제 서식 렌더러가 생기기 전까지 서명 완료본·증명서 본문으로 씁니다.
 *
 * 기본 글꼴(Helvetica)은 ASCII만 그리므로, ASCII가 아닌 글자는 `\uXXXX`로 바꿔 적습니다. 제목은 문서 정보(`/Title`)에
 * UTF-16BE로 넣어 뷰어의 제목 표시줄에는 한글로 보입니다.
 *
 * @example
 * ```ts
 * minimalPdf('근로계약서', ['startDate: 2026-03-01']) // %PDF-1.4 ... %%EOF
 * ```
 */
export function minimalPdf(title: string, lines: ReadonlyArray<string>): Uint8Array {
  const text = [title, '', ...lines].map(asciiLine)
  const stream = ['BT', '/F1 11 Tf', '50 800 Td', '14 TL', ...text.map((line) => `(${escapePdf(line)}) '`), 'ET'].join(
    '\n',
  )
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    `<< /Title <FEFF${utf16beHex(title)}> /Producer (semu) >>`,
  ]
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, 'latin1'))
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(body, 'latin1')
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  body += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new Uint8Array(Buffer.from(body, 'latin1'))
}

function asciiLine(line: string): string {
  return [...line]
    .map((char) => {
      const code = char.codePointAt(0)!
      return code >= 0x20 && code < 0x7f ? char : `\\u${code.toString(16).padStart(4, '0')}`
    })
    .join('')
}

function escapePdf(line: string): string {
  return line.replace(/[\\()]/g, (char) => `\\${char}`)
}

function utf16beHex(text: string): string {
  const swapped = Buffer.from(text, 'utf16le').swap16()
  return swapped.toString('hex').toUpperCase()
}
