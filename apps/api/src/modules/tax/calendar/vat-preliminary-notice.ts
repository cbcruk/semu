import type { BusinessType } from '../../identity-access/actor.types.ts'
import type { VatPreliminaryElectionReason } from './filing-calendar.types.ts'

/** {@link decideVatPreliminaryKind}의 입력입니다. 일반과세자의 예정신고기간 하나에 대한 값입니다. */
export interface VatPreliminaryQuery {
  businessType: BusinessType
  /** 직전 과세기간 공급가액의 합계액(원)입니다. 직전 과세기간이 없거나 모르면 `null`입니다. */
  priorPeriodSupplyAmount: number | null
  /** 이 예정신고기간에 예정신고를 고른 사유입니다. 고르지 않았으면 `null`입니다. */
  election: VatPreliminaryElectionReason | null
}

/**
 * 법 제48조 ③의 "대통령령으로 정하는 법인사업자"를 가르는 직전 과세기간 공급가액 합계액입니다. 이 금액 미만인 법인이
 * 예정고지 대상입니다(부가가치세법 시행령 제90조 ④).
 */
const 예정고지법인공급가액기준 = 150_000_000

/**
 * 일반과세자의 부가세 예정신고기간(1–3월, 7–9월)을 예정고지(`NOTICE`)로 받는지 예정신고(`PRELIMINARY`)하는지 정합니다.
 *
 * - 사업자는 원칙적으로 예정신고합니다(부가가치세법 제48조 ①)
 * - 개인사업자와 직전 과세기간 공급가액 합계액이 1억 5천만 원 미만인 법인사업자는 세무서가 직전 과세기간 납부세액의
 *   50%를 고지·징수합니다(제48조 ③, 시행령 제90조 ④)
 * - 고지 대상이라도 휴업·사업 부진으로 예정신고기간의 공급가액 또는 납부세액이 직전 과세기간의 1/3에 미달하거나,
 *   조기환급을 받으려면 예정신고할 수 있습니다(제48조 ④, 시행령 제90조 ⑥). 사유가 맞는지는 대리인이 판단하고
 *   고른 사유만 받습니다
 *
 * 직전 과세기간이 없거나(신설 법인) 공급가액을 모르는 법인은 고지 대상인지 알 수 없어 원칙대로 예정신고입니다.
 * 고지할 금액이 50만 원 미만이거나 간이과세자에서 일반과세자로 바뀐 경우 등 고지하지 않는 경우(제48조 ③ 단서)는
 * 직전 과세기간 납부세액을 받지 않으므로 고지로 두고 대리인이 취소합니다.
 *
 * @example
 * ```ts
 * decideVatPreliminaryKind({ businessType: 'CORPORATION', priorPeriodSupplyAmount: 149_999_999, election: null })
 * // 'NOTICE'
 * ```
 */
export function decideVatPreliminaryKind(query: VatPreliminaryQuery): 'PRELIMINARY' | 'NOTICE' {
  if (query.election !== null) return 'PRELIMINARY'
  return 예정고지대상인가(query.businessType, query.priorPeriodSupplyAmount) ? 'NOTICE' : 'PRELIMINARY'
}

function 예정고지대상인가(businessType: BusinessType, 직전과세기간공급가액: number | null): boolean {
  if (businessType === 'INDIVIDUAL') return true
  return 직전과세기간공급가액 !== null && 직전과세기간공급가액 < 예정고지법인공급가액기준
}
