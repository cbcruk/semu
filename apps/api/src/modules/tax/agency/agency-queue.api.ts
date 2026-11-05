import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { Page, PageQueryFields } from '../../../shared/http/pagination.ts'
import { PermissionDenied } from '../../../shared/problem/problem.ts'
import { CalendarDate } from '../../../shared/time/date-schemas.ts'
import { AgencyAuthentication } from '../../identity-access/authentication.ts'
import { CompanyId, CompanyNotFound } from '../../identity-access/companies/company.ts'
import { ActionCardKind } from '../action-cards/action-card.ts'
import { FilingStatus, TaxType } from '../filings/filing.ts'
import { AgencyActionCard, AgencyFiling } from './agency-work.ts'

const TrueFalse = Schema.Literals(['true', 'false'])

/**
 * 세무 대리인이 담당 회사 전체를 가로질러 보는 작업 큐입니다. 대리인 범위 토큰으로만 부르고, 읽기만 합니다.
 *
 * 현행 `GET /desk/filings/?status=&due_before=&cursor=`를 대신합니다. 신고 건을 처리하려면 그 회사 토큰으로 전환해
 * `POST /filings/{filingId}:{command}`를 부릅니다. 배정되지 않은 회사를 `companyId`로 고르면 404 `COMPANY_NOT_FOUND`입니다.
 */
export class AgencyQueueApi extends HttpApiGroup.make('agencyQueue')
  .add(
    HttpApiEndpoint.get('filings', '/agency/filings', {
      query: Schema.Struct({
        ...PageQueryFields,
        companyId: Schema.optionalKey(CompanyId),
        taxType: Schema.optionalKey(TaxType),
        status: Schema.optionalKey(FilingStatus),
        /** `true`면 끝나지 않은 신고 건만, `false`면 끝난 신고 건만입니다. */
        open: Schema.optionalKey(TrueFalse),
        /** `true`면 기한이 지난 신고 건만입니다. */
        overdue: Schema.optionalKey(TrueFalse),
        /** 기한(신고 기한, 없으면 납부 기한)이 이날 이후인 신고 건만입니다. */
        dueFrom: Schema.optionalKey(CalendarDate),
        /** 기한이 이날 이전인 신고 건만입니다. 현행 `due_before`입니다. */
        dueTo: Schema.optionalKey(CalendarDate),
      }),
      success: Page(AgencyFiling),
      error: [PermissionDenied, CompanyNotFound],
    }),
    HttpApiEndpoint.get('actionCards', '/agency/action-cards', {
      query: Schema.Struct({
        ...PageQueryFields,
        /** `OPEN`은 진행중(마감일 순), `CLOSED`는 완료·기한 경과(최근 순)입니다. 기본 `OPEN`입니다. */
        status: Schema.optionalKey(Schema.Literals(['OPEN', 'CLOSED'])),
        companyId: Schema.optionalKey(CompanyId),
        kind: Schema.optionalKey(ActionCardKind),
      }),
      success: Page(AgencyActionCard),
      error: [PermissionDenied, CompanyNotFound],
    }),
  )
  .middleware(AgencyAuthentication) {}
