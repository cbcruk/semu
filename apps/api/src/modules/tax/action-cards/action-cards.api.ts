import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { Page, PageQueryFields } from '../../../shared/http/pagination.ts'
import { EntitlementRequired, PermissionDenied, TermsReagreementRequired } from '../../../shared/problem/problem.ts'
import { Authentication } from '../../identity-access/authentication.ts'
import { ActionCard, ActionCardClosed, ActionCardId, ActionCardNotFound, ActionCardSummary } from './action-card.ts'

const accessErrors = [PermissionDenied, EntitlementRequired, TermsReagreementRequired]

/**
 * 홈의 할 일 카드입니다. 신고 건 전이가 카드를 열고 닫고, 사용자는 완료·넘어가기만 합니다.
 *
 * 행위자가 권한·플랜을 갖지 못한 카드는 목록·개수·완료 모두에서 없는 것으로 봅니다.
 */
export class ActionCardsApi extends HttpApiGroup.make('actionCards')
  .add(
    HttpApiEndpoint.get('list', '/action-cards', {
      query: Schema.Struct({
        ...PageQueryFields,
        /** `OPEN`은 진행중(마감일 순), `CLOSED`는 완료·기한 경과(최근 순)입니다. 기본 `OPEN`입니다. */
        status: Schema.optionalKey(Schema.Literals(['OPEN', 'CLOSED'])),
      }),
      success: Page(ActionCard),
      error: accessErrors,
    }),
    HttpApiEndpoint.get('summary', '/action-cards::summary', { success: ActionCardSummary, error: accessErrors }),
    HttpApiEndpoint.post('complete', '/action-cards/:cardId::complete', {
      params: { cardId: ActionCardId },
      payload: Schema.Struct({
        /** `DONE`은 완료, `SKIP`은 넘어가기입니다. 마감일이 지난 넘어가기는 `SKIPPED_OVERDUE`가 됩니다. */
        completion: Schema.Literals(['DONE', 'SKIP']),
      }),
      success: ActionCard,
      error: [...accessErrors, ActionCardNotFound, ActionCardClosed],
    }),
  )
  .middleware(Authentication) {}
