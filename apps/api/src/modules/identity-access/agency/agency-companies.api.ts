import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { Page, PageQueryFields } from '../../../shared/http/pagination.ts'
import { PermissionDenied } from '../../../shared/problem/problem.ts'
import { UserId } from '../accounts/user.ts'
import { AgencyAuthentication } from '../authentication.ts'
import { AgencyCompany } from './agency-company.ts'

/**
 * 세무 대리인 작업 큐의 담당 회사입니다. 대리인 범위 토큰(`POST /auth/sessions:switch-agency`)으로만 부릅니다.
 *
 * 회사 범위 토큰이면 403 `TOKEN_SCOPE_MISMATCH`입니다. 배정되지 않은 회사는 보이지 않습니다.
 */
export class AgencyCompaniesApi extends HttpApiGroup.make('agencyCompanies')
  .add(
    HttpApiEndpoint.get('list', '/agency/companies', {
      query: Schema.Struct({
        ...PageQueryFields,
        /** 이 담당자에게 배정된 회사만입니다. 팀장이 팀원별로 볼 때 씁니다. */
        assigneeId: Schema.optionalKey(UserId),
      }),
      success: Page(AgencyCompany),
      error: PermissionDenied,
    }),
  )
  .middleware(AgencyAuthentication) {}
