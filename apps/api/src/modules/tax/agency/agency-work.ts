import { Schema } from 'effect'
import { CompanyId } from '../../identity-access/companies/company.ts'
import { ActionCard } from '../action-cards/action-card.ts'
import { FilingCommand, FilingSummary } from '../filings/filing.ts'

/** 대리인 작업 큐 항목이 속한 회사입니다. 그 회사의 일을 하려면 `id`로 `POST /auth/sessions:switch-company`를 부릅니다. */
export const AgencyCompanyRef = Schema.Struct({ id: CompanyId, name: Schema.String })

/**
 * 대리인 작업 큐의 신고 건 한 줄입니다. 회사 목록(`GET /filings`)의 항목에 회사와 대리인이 지금 보낼 수 있는 커맨드를 더했습니다.
 *
 * `allowedActions`가 비어 있으면 고객 차례이거나 끝난 신고 건입니다.
 */
export const AgencyFiling = Schema.Struct({
  ...FilingSummary.fields,
  company: AgencyCompanyRef,
  allowedActions: Schema.Array(FilingCommand),
})

export type AgencyFiling = typeof AgencyFiling.Type

/** 대리인 작업 큐의 할 일 카드 한 줄입니다. 카드는 고객이 할 일이라 대리인에게는 독촉할 목록입니다. */
export const AgencyActionCard = Schema.Struct({
  ...ActionCard.fields,
  company: AgencyCompanyRef,
})

export type AgencyActionCard = typeof AgencyActionCard.Type
