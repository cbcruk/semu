import { describe, expect, it } from 'vitest'
import { minimalPdf } from './minimal-pdf.ts'

describe('글자만 있는 PDF(minimalPdf)', () => {
  const text = Buffer.from(minimalPdf('근로계약서 (A)', ['startDate: 2026-03-01', '주소: 서울'])).toString('latin1')

  it('PDF 머리와 끝 표시가 있고, 상호 참조표가 객체 위치를 가리킵니다', () => {
    expect(text.startsWith('%PDF-1.4\n')).toBe(true)
    expect(text.endsWith('%%EOF\n')).toBe(true)
    const xref = Number(text.match(/startxref\n(\d+)\n/)![1])
    expect(text.slice(xref, xref + 4)).toBe('xref')
    const offsets = [...text.matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]))
    offsets.forEach((offset, index) => expect(text.slice(offset).startsWith(`${index + 1} 0 obj`)).toBe(true))
  })

  it('ASCII가 아닌 글자는 \\u로 적고 괄호는 이스케이프합니다', () => {
    expect(text).toContain('(\\\\uadfc')
    expect(text).toContain('\\(A\\)')
    expect(text).toContain('(startDate: 2026-03-01)')
  })

  it('제목은 문서 정보에 UTF-16BE로 넣습니다', () => {
    expect(text).toContain('/Title <FEFFADFCB85CACC4C57DC11C')
  })
})
