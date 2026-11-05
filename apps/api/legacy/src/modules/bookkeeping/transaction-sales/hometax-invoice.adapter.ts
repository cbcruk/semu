import { createHash } from 'node:crypto'
import type { BusinessTypeRecord, HometaxInvoiceAdapter, InvoiceDetailResult, InvoicePublishResult } from './transaction-sales.types'

/** Buyer business number the fake adapter rejects, to exercise the failure path. */
export const FAKE_REJECTED_BUYER_NUMBER = '0000000000'

/**
 * Creates a deterministic {@linkcode HometaxInvoiceAdapter} for development and tests.
 *
 * - The approval number is `<write date>-41000000-<8 digits from the transaction ID hash>`.
 * - A buyer business number of {@linkcode FAKE_REJECTED_BUYER_NUMBER} is rejected.
 * - Business types are a fixed main and secondary registration.
 */
export function createFakeHometaxInvoiceAdapter(): HometaxInvoiceAdapter {
  return {
    async publish(request): Promise<InvoicePublishResult> {
      if (request.snapshot['buyer_business_number'] === FAKE_REJECTED_BUYER_NUMBER) {
        return { ok: false, error_code: 'BUYER_NOT_FOUND', error_message: '공급받는 자의 사업자등록번호를 확인해 주세요.' }
      }
      const digits = (Number.parseInt(createHash('sha256').update(request.transactionId).digest('hex').slice(0, 12), 16) % 100_000_000)
        .toString()
        .padStart(8, '0')
      const writeDate = String(request.snapshot['write_date'] ?? '').replaceAll('-', '')
      return { ok: true, issue_no: `${writeDate}-41000000-${digits}`, issue_datetime: request.requestedAt }
    },
    async fetchDetail(_companyId, issueNo): Promise<InvoiceDetailResult> {
      return { issue_no: issueNo, found: true }
    },
    async fetchBusinessTypes(): Promise<BusinessTypeRecord[]> {
      return [
        { code: '722000', business_type: '정보통신업', business_class: '응용 소프트웨어 개발 및 공급업', is_main: true },
        { code: '749939', business_type: '사업지원 서비스업', business_class: '그 외 기타 사업지원 서비스업', is_main: false },
      ]
    },
  }
}
