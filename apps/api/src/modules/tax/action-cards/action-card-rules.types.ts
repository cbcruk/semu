import type { FilingCommand } from '../tax.types.ts'

/**
 * 신고 건에서 생기는 할 일 카드 종류입니다.
 *
 * - `SUBMIT_MATERIALS`: 자료 제출
 * - `CONFIRM_LEDGER`: 매입매출장 확인
 * - `REVIEW_FILING_RESULT`: 신고 결과(신고서·고지서) 확인
 * - `PAY_TAX`: 납부
 */
export type ActionCardKind = 'SUBMIT_MATERIALS' | 'CONFIRM_LEDGER' | 'REVIEW_FILING_RESULT' | 'PAY_TAX'

/** 카드 상태입니다. 닫힌 두 상태는 완료 탭에 함께 나옵니다. */
export type ActionCardStatus = 'OPEN' | 'DONE' | 'SKIPPED_OVERDUE'

/** 사용자가 카드를 닫을 때 고르는 이유입니다. `DONE`은 완료, `SKIP`은 넘어가기입니다. */
export type ActionCardCompletion = 'DONE' | 'SKIP'

/** 신고 건 전이 하나가 카드에 미치는 효과입니다. */
export type ActionCardEffect =
  | { op: 'OPEN'; kind: ActionCardKind; dueDate: string | null }
  | { op: 'CLOSE'; kind: ActionCardKind }
  | { op: 'CLOSE_ALL' }

/** 카드 효과를 정할 때 보는 신고 건의 값입니다. 전이를 적용한 뒤의 값입니다. */
export interface FilingCardFacts {
  dueDate: string | null
  paymentDue: string | null
  submitDue: string | null
  payableAmount: number | null
}

/** 카드 효과를 만드는 신고 건 사건입니다. 커맨드 말고도 일정 배치의 자동 취소가 있습니다. */
export type FilingCardTrigger = FilingCommand | 'SCHEDULE_CANCELED'

/** 카드를 열고 닫을 때 바뀌는 값입니다. */
export interface CardOpenState {
  status: ActionCardStatus
  reopenCount: number
  dueDate: string | null
  completedAt: string | null
}
