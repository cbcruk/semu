import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { authorizeAgency } from '../authorization.ts'
import { AgencyCompanies } from './agency-companies.ts'

/** 대리인 담당 회사 목록 핸들러입니다. 플랜과 상관없이 담당 회사를 모두 보여 줍니다. */
export const AgencyCompaniesHttpLive = HttpApiBuilder.group(
  Api,
  'agencyCompanies',
  Effect.fn(function* (handlers) {
    const companies = yield* AgencyCompanies
    return handlers.handleAll({
      list: ({ query }) =>
        authorizeAgency({ permission: 'company:read' }).pipe(
          Effect.flatMap((scope) => companies.list(scope.companies, query)),
        ),
    })
  }),
)
