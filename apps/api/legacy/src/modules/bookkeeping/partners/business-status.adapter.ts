import type { BusinessStatus, BusinessStatusAdapter } from '../../platform/adapters/business-status.adapter'

/**
 * Creates a deterministic {@linkcode BusinessStatusAdapter} standing in for the NTS business status lookup.
 *
 * The last digit decides the answer: `9` is closed, `8` is suspended and
 * anything else is a registered general taxpayer.
 */
export function createFakeBusinessStatusAdapter(): BusinessStatusAdapter {
  return {
    async lookup(businessNumber): Promise<BusinessStatus> {
      const last = businessNumber.at(-1)
      if (last === '9') return { businessStatus: 'closed', taxationType: '일반과세자', closedOn: '2025-12-31' }
      if (last === '8') return { businessStatus: 'suspended', taxationType: '일반과세자', closedOn: null }
      return { businessStatus: 'registered', taxationType: '일반과세자', closedOn: null }
    },
  }
}
