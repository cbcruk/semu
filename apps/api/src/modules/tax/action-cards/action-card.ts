import { Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import { IdSchema } from '../../../shared/ids/id-schema.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { problemType } from '../../../shared/problem/problem.ts'
import type { Permission, Plan } from '../../identity-access/actor.types.ts'
import { FilingId, FilingKind, TaxType } from '../filings/filing.ts'
import type { FilingKind as FilingKindType, TaxType as TaxTypeType } from '../tax.types.ts'
import type {
  ActionCardKind as ActionCardKindType,
  ActionCardStatus as ActionCardStatusType,
} from './action-card-rules.types.ts'

/** 할 일 카드 ID입니다. 예: `acd_01J...` */
export const ActionCardId = IdSchema('actionCard')

/** 할 일 카드 종류입니다. */
export const ActionCardKind = Schema.Literals(['SUBMIT_MATERIALS', 'CONFIRM_LEDGER', 'REVIEW_FILING_RESULT', 'PAY_TAX'])

/** 할 일 카드 상태입니다. */
export const ActionCardStatus = Schema.Literals(['OPEN', 'DONE', 'SKIPPED_OVERDUE'])

/**
 * 할 일 카드입니다. 제목 문구와 바로가기 화면은 클라이언트가 `kind`와 `subject`로 정합니다.
 */
export const ActionCard = Schema.Struct({
  id: ActionCardId,
  kind: ActionCardKind,
  status: ActionCardStatus,
  /** 카드를 만든 신고 건입니다. */
  subject: Schema.Struct({
    type: Schema.Literal('FILING'),
    filingId: FilingId,
    taxType: TaxType,
    filingKind: FilingKind,
    periodKey: Schema.String,
  }),
  dueDate: Schema.NullOr(Schema.String),
  /** 닫혔다가 다시 열린 횟수입니다. 반려되면 자료 제출 카드가 다시 열립니다. */
  reopenCount: Schema.Int,
  createdAt: Schema.String,
  completedAt: Schema.NullOr(Schema.String),
})

export type ActionCard = typeof ActionCard.Type

/** 할 일 카드 탭별 개수와 가장 가까운 마감일입니다. */
export const ActionCardSummary = Schema.Struct({
  openCount: Schema.Int,
  closedCount: Schema.Int,
  nearestDueDate: Schema.NullOr(Schema.String),
})

/** 저장하는 할 일 카드입니다. 보려면 `requires`의 권한과 플랜이 있어야 합니다. */
export interface ActionCardRecord {
  id: Id<'actionCard'>
  companyId: Id<'company'>
  kind: ActionCardKindType
  status: ActionCardStatusType
  subject: {
    type: 'FILING'
    filingId: Id<'filing'>
    taxType: TaxTypeType
    filingKind: FilingKindType
    periodKey: string
  }
  requires: { permission: Permission; plans: ReadonlyArray<Plan> }
  dueDate: string | null
  reopenCount: number
  createdAt: string
  completedAt: string | null
}

/** 요청한 카드가 없거나 볼 수 없는 카드입니다. */
export class ActionCardNotFound extends HttpApiError.Problem<ActionCardNotFound>()(
  'ActionCardNotFound',
  { type: problemType('ACTION_CARD_NOT_FOUND'), status: 404, title: 'Action card not found' },
  { code: Schema.tag('ACTION_CARD_NOT_FOUND') },
) {}

/** 이미 닫힌 카드입니다. */
export class ActionCardClosed extends HttpApiError.Problem<ActionCardClosed>()(
  'ActionCardClosed',
  { type: problemType('ACTION_CARD_CLOSED'), status: 409, title: 'Action card is already closed' },
  { code: Schema.tag('ACTION_CARD_CLOSED'), currentStatus: ActionCardStatus },
) {}
