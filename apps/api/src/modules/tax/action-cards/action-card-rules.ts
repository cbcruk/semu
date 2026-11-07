import { addDays } from '../../../shared/time/calendar.ts'
import type { FilingActorKind, FilingDocumentType } from '../tax.types.ts'
import type {
  ActionCardCompletion,
  ActionCardEffect,
  ActionCardStatus,
  CardOpenState,
  FilingCardFacts,
  FilingCardTrigger,
} from './action-card-rules.types.ts'

/** 매입매출장 확인 카드의 마감일을 신고 기한보다 며칠 앞에 둘지입니다. */
export const LEDGER_CONFIRMATION_LEAD_DAYS = 3

/**
 * 신고 건 전이가 할 일 카드에 미치는 효과입니다. 전이와 같은 요청에서 적용합니다.
 *
 * - 자료 요청·반려·제출 취소: 자료 제출 카드를 엽니다 (마감 `submitDue`)
 * - 제출·검토 시작: 자료 제출 카드를 닫습니다
 * - 매입매출장 업로드: 확인 카드를 엽니다 (마감 신고 기한 − 3일). 확인·이의는 닫습니다
 * - 신고·고지 등록: 결과 확인 카드를 열고(마감 신고 기한, 없으면 납부 기한), 낼 세액이 있으면 납부 카드도 엽니다
 * - 납부·종결: 납부 카드를 닫습니다. 취소는 열린 카드를 모두 닫습니다
 *
 * 이미 있는 카드를 다시 열면 같은 카드의 마감일을 바꾸고 다시 연 횟수를 올립니다.
 */
export function filingCardEffects(trigger: FilingCardTrigger, filing: FilingCardFacts): ActionCardEffect[] {
  switch (trigger) {
    case 'REQUEST':
    case 'REJECT':
    case 'UNSUBMIT':
      return [{ op: 'OPEN', kind: 'SUBMIT_MATERIALS', dueDate: filing.submitDue }]
    case 'SUBMIT':
    case 'START_REVIEW':
      return [{ op: 'CLOSE', kind: 'SUBMIT_MATERIALS' }]
    case 'UPLOAD_LEDGER':
      return [
        {
          op: 'OPEN',
          kind: 'CONFIRM_LEDGER',
          dueDate: filing.dueDate === null ? null : addDays(filing.dueDate, -LEDGER_CONFIRMATION_LEAD_DAYS),
        },
      ]
    case 'CONFIRM_LEDGER':
    case 'DISPUTE_LEDGER':
      return [{ op: 'CLOSE', kind: 'CONFIRM_LEDGER' }]
    case 'FILE':
    case 'RECORD_NOTICE': {
      const 효과: ActionCardEffect[] = [
        { op: 'OPEN', kind: 'REVIEW_FILING_RESULT', dueDate: filing.dueDate ?? filing.paymentDue },
      ]
      if ((filing.payableAmount ?? 0) > 0) 효과.push({ op: 'OPEN', kind: 'PAY_TAX', dueDate: filing.paymentDue })
      return 효과
    }
    case 'PAY':
    case 'CLOSE':
      return [{ op: 'CLOSE', kind: 'PAY_TAX' }]
    case 'CANCEL':
    case 'SCHEDULE_CANCELED':
      return [{ op: 'CLOSE_ALL' }]
    case 'START_PREPARING':
      return []
  }
}

/**
 * 사용자가 카드를 닫을 때의 상태입니다.
 *
 * `DONE`은 언제나 `DONE`입니다. `SKIP`은 회사 시간대 오늘이 마감일을 지났으면 `SKIPPED_OVERDUE`, 아니면 `DONE`입니다.
 * 마감일 당일은 지난 것이 아닙니다.
 */
export function completedCardStatus(
  completion: ActionCardCompletion,
  dueDate: string | null,
  today: string,
): Exclude<ActionCardStatus, 'OPEN'> {
  const 마감일경과임 = dueDate !== null && today > dueDate
  return completion === 'SKIP' && 마감일경과임 ? 'SKIPPED_OVERDUE' : 'DONE'
}

/**
 * 카드를 열 때의 상태입니다. 같은 신고 건·종류의 카드가 있으면 새로 만들지 않고 그 카드를 다시 엽니다.
 *
 * 닫힌 카드를 다시 열면 `reopenCount`가 1 오르고, 이미 열린 카드는 마감일만 바꿉니다.
 */
export function openCardState(existing: CardOpenState | undefined, dueDate: string | null): CardOpenState {
  if (existing === undefined) return { status: 'OPEN', reopenCount: 0, dueDate, completedAt: null }
  const 닫힌카드임 = existing.status !== 'OPEN'
  return { status: 'OPEN', reopenCount: existing.reopenCount + (닫힌카드임 ? 1 : 0), dueDate, completedAt: null }
}

/** 이 문서를 열면 결과 확인 카드를 닫는지입니다. 고객이 신고서나 예정고지서를 열 때만 닫습니다. */
export function documentViewClosesReviewCard(documentType: FilingDocumentType, viewer: FilingActorKind): boolean {
  return viewer === 'CLIENT' && (documentType === 'RETURN' || documentType === 'NOTICE')
}

/**
 * 진행중 탭 정렬입니다. 마감일이 이른 순이고, 마감일 없는 카드는 뒤에, 같으면 만든 순입니다.
 */
export function compareOpenCards(
  a: { dueDate: string | null; createdAt: string; id: string },
  b: { dueDate: string | null; createdAt: string; id: string },
): number {
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === null) return 1
    if (b.dueDate === null) return -1
    return a.dueDate.localeCompare(b.dueDate)
  }
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
}

/** 완료 탭 정렬입니다. 최근에 닫은 카드가 먼저입니다. */
export function compareClosedCards(
  a: { completedAt: string | null; id: string },
  b: { completedAt: string | null; id: string },
): number {
  return (b.completedAt ?? '').localeCompare(a.completedAt ?? '') || b.id.localeCompare(a.id)
}
