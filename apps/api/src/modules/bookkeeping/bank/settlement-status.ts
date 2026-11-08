import type { AccountTitleInfo } from '../account-titles/account-title.types.ts'
import type { Direction, SettlementMatchStatus } from './bank.types.ts'

/** 거래처 대금 입출금 그룹(거래대금)의 코드입니다. 이 그룹으로 분류한 거래만 증빙과 맞춥니다. */
export const TRADE_GROUP_CODE = 'trade'

/**
 * 입출금 거래의 증빙 연결 상태입니다.
 *
 * | 조건 | 상태 |
 * | --- | --- |
 * | 미분류이거나 거래대금 그룹이 아닌 계정 | `NOT_APPLICABLE` |
 * | 거래대금인데 거래처 없음 | `PARTNER_REQUIRED` (화면 "거래처 필요") |
 * | 연결 금액 합계 = 거래 금액 절댓값 | `MATCHED` |
 * | 그 밖(부분 연결 포함) | `UNMATCHED` |
 */
export function settlementMatchStatus(input: {
  account: Pick<AccountTitleInfo, 'groupCode'> | undefined
  partnerId: string | null
  amount: number
  linkedAmount: number
}): SettlementMatchStatus {
  if (input.account === undefined || input.account.groupCode !== TRADE_GROUP_CODE) return 'NOT_APPLICABLE'
  if (input.partnerId === null) return 'PARTNER_REQUIRED'
  return input.linkedAmount === Math.abs(input.amount) ? 'MATCHED' : 'UNMATCHED'
}

/** 증빙 연결을 거절하는 이유입니다. */
export type SettlementLinkProblem =
  'SIDE_MISMATCH' | 'PARTNER_MISMATCH' | 'EXCEEDS_EVIDENCE' | 'EXCEEDS_TRANSACTION' | 'AMOUNT_NOT_POSITIVE'

/**
 * 입출금 거래 하나에 증빙 연결을 바꿔 넣을 수 있는지 검사합니다. 문제가 없으면 `undefined`입니다.
 *
 * - 입금은 매출 증빙, 출금은 매입 증빙만 정산합니다
 * - 거래와 증빙 양쪽에 거래처가 있으면 같아야 합니다
 * - 증빙마다 다른 거래가 이미 연결한 금액 + 이번 금액이 증빙 합계 절댓값을 넘으면 안 됩니다
 * - 이 거래의 연결 금액 합계가 거래 금액 절댓값을 넘으면 안 됩니다
 */
export function settlementLinkProblem(input: {
  direction: Direction
  transactionAmount: number
  transactionPartnerId: string | null
  links: ReadonlyArray<{
    evidenceSide: 'SALES' | 'PURCHASE'
    evidencePartnerId: string | null
    evidenceTotal: number
    linkedElsewhere: number
    amount: number
  }>
  /** 이번에 바꾸지 않고 남는 이 거래의 다른 연결 금액 합계입니다. */
  keptAmount: number
}): SettlementLinkProblem | undefined {
  const 맞는증빙구분 = input.direction === 'DEPOSIT' ? 'SALES' : 'PURCHASE'
  let 연결금액합계 = input.keptAmount
  for (const link of input.links) {
    if (link.amount <= 0) return 'AMOUNT_NOT_POSITIVE'
    if (link.evidenceSide !== 맞는증빙구분) return 'SIDE_MISMATCH'
    if (
      input.transactionPartnerId !== null &&
      link.evidencePartnerId !== null &&
      input.transactionPartnerId !== link.evidencePartnerId
    ) {
      return 'PARTNER_MISMATCH'
    }
    if (link.linkedElsewhere + link.amount > Math.abs(link.evidenceTotal)) return 'EXCEEDS_EVIDENCE'
    연결금액합계 += link.amount
  }
  return 연결금액합계 > Math.abs(input.transactionAmount) ? 'EXCEEDS_TRANSACTION' : undefined
}
