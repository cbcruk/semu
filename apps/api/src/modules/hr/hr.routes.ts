import { Hono } from 'hono'
import type { AppDeps, AppEnv, DomainRoutes } from '../../app.types'
import { resolveHrAdapters } from './adapters/hr-adapters'
import { certificateRoutes, certificateSignerRoutes } from './certificates/certificates.routes'
import { contractRoutes } from './contracts/contracts.routes'
import { deductionRoutes } from './deduction/deduction.routes'
import { documentFormRoutes } from './document-forms/document-forms.routes'
import { documentRoutes } from './documents/documents.routes'
import { eSignRequestRoutes } from './e-sign/e-sign-requests.routes'
import { eSignSettingsRoutes } from './e-sign/e-sign-settings.routes'
import { eSignSignerRoutes } from './e-sign/e-sign-signer.routes'
import { employeeRoutes } from './employees/employees.routes'
import { familyRoutes } from './family/family.routes'
import { leaveRoutes } from './leaves/leaves.routes'
import { legacyEmployeeRoutes } from './legacy/legacy.routes'
import { memoRoutes } from './memo/memo.routes'
import { nonWageEmployeeRoutes } from './non-wage/non-wage.routes'
import { organizationRoutes } from './organization/organization.routes'
import { retirementRoutes } from './retirement/retirement.routes'
import type { HrContext } from './shared/hr-context.types'
import { socialInsuranceRoutes } from './social-insurance/social-insurance.routes'

/**
 * Builds the HR domain's routers.
 *
 * - `company`: 구성원 정보 and its sub-resources, departments and positions, the legacy 직원 관리 list, e-sign and certificate administration.
 * - `public`: the worker signing and certificate links under `/api/employment/{e-sign,certificates}/:token`, authenticated by token and `X-ESign-Session`.
 * - `account`: the global 서식 모음 catalog under `/nexus-api/document-form`.
 */
export function hrRoutes(deps: AppDeps): DomainRoutes {
  const context: HrContext = { deps, adapters: resolveHrAdapters(deps) }
  const company = new Hono<AppEnv>()
    .route('/', employeeRoutes(context))
    .route('/', memoRoutes(context))
    .route('/', familyRoutes(context))
    .route('/', leaveRoutes(context))
    .route('/', contractRoutes(context))
    .route('/', retirementRoutes(context))
    .route('/', socialInsuranceRoutes(context))
    .route('/', deductionRoutes(context))
    .route('/', documentRoutes(context))
    .route('/', organizationRoutes(context))
    .route('/', nonWageEmployeeRoutes(context))
    .route('/', legacyEmployeeRoutes(context))
    .route('/', eSignSettingsRoutes(context))
    .route('/', eSignRequestRoutes(context))
    .route('/', certificateRoutes(context))
  const publicRoutes = new Hono<AppEnv>().route('/', eSignSignerRoutes(context)).route('/', certificateSignerRoutes(context))
  return { public: publicRoutes, account: documentFormRoutes(context), company }
}
