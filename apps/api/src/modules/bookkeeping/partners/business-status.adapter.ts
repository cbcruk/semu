import type { BusinessStatusAdapter, BusinessStatusResult } from './partners.types'

/**
 * Creates a deterministic {@linkcode BusinessStatusAdapter} standing in for the NTS business status lookup.
 *
 * The last digit decides the answer: `9` is closed, `8` is suspended and
 * anything else is a registered general taxpayer.
 */
export function createFakeBusinessStatusAdapter(): BusinessStatusAdapter {
  return {
    async lookup(businessNumber): Promise<BusinessStatusResult> {
      const last = businessNumber.at(-1)
      if (last === '9') return { business_status: 'closed', taxation_type: '일반과세자', closed_on: '2025-12-31' }
      if (last === '8') return { business_status: 'suspended', taxation_type: '일반과세자', closed_on: null }
      return { business_status: 'registered', taxation_type: '일반과세자', closed_on: null }
    },
  }
}
