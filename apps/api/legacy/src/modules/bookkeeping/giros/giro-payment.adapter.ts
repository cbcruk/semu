import type { GiroPaymentAdapter, GiroPaymentResult } from './giros.types'

/** Account password the fake gateway rejects, to exercise the failure path. */
export const FAKE_WRONG_PASSWORD = '0000'

/**
 * Creates a deterministic {@linkcode GiroPaymentAdapter} for development and tests.
 *
 * Payments succeed unless the password is {@linkcode FAKE_WRONG_PASSWORD}, or a
 * K bank (`089`) account pays national tax, which the bank does not support.
 */
export function createFakeGiroPaymentAdapter(): GiroPaymentAdapter {
  return {
    async pay(request): Promise<GiroPaymentResult> {
      if (request.accountPassword === FAKE_WRONG_PASSWORD) return { ok: false, result_code: 'E101', result_message: '계좌 비밀번호가 일치하지 않습니다.' }
      if (request.bankCode === '089' && request.giroType === '국세') {
        return { ok: false, result_code: 'E201', result_message: '케이뱅크는 지방세·세외수입만 납부할 수 있습니다.' }
      }
      return { ok: true, result_code: '0000', result_message: '정상 처리되었습니다.' }
    },
  }
}
