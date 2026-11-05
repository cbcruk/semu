import { Layer } from 'effect'
import { TableFactory } from '../../shared/persistence/record-table.ts'
import { AgencyCompanies } from './agency/agency-companies.ts'
import { AgencyCompaniesHttpLive } from './agency/agency-companies.http.ts'
import { AuditLogsHttpLive } from './audit/audit-logs.http.ts'
import { Companies } from './companies/companies.ts'
import { CompanyDirectory } from './companies/company-directory.ts'
import { CompanyRegistrationsHttpLive, CurrentCompanyHttpLive } from './companies/companies.http.ts'
import { InvitationRepository } from './invitations/invitation-repository.ts'
import { InvitationLinksHttpLive, InvitationsHttpLive } from './invitations/invitations.http.ts'
import { Invitations } from './invitations/invitations.ts'
import { MembersHttpLive } from './members/members.http.ts'
import { Members } from './members/members.ts'
import { RolesHttpLive } from './roles/roles.http.ts'
import { Roles } from './roles/roles.ts'
import { ActorDirectory } from './access/actor-directory.ts'
import { UserRepository } from './accounts/user-repository.ts'
import { AgencyAssignmentRepository } from './agency/agency-assignment-repository.ts'
import { AuditLog } from './audit/audit-log.ts'
import { CompanyRepository } from './companies/company-repository.ts'
import {
  demoAgreements,
  demoAssignments,
  demoCompanies,
  demoMemberships,
  demoRoles,
  demoTerms,
  demoUsers,
} from './demo-seed.ts'
import { MeHttpLive } from './me/me.http.ts'
import { MeService } from './me/me.ts'
import { MembershipRepository } from './members/membership-repository.ts'
import { Mailer } from './notifications/mailer.ts'
import { RoleRepository } from './roles/role-repository.ts'
import { SessionRepository } from './sessions/session-repository.ts'
import { SessionsHttpLive } from './sessions/sessions.http.ts'
import { Sessions } from './sessions/sessions.ts'
import { TermRepository } from './terms/term-repository.ts'
import { TermAgreementsHttpLive, TermsHttpLive } from './terms/terms.http.ts'
import { Terms } from './terms/terms.ts'

const ServicesLive = Layer.mergeAll(Invitations.layer, MeService.layer, AgencyCompanies.layer).pipe(
  Layer.provideMerge(Layer.mergeAll(Terms.layer, Companies.layer, Members.layer, Roles.layer)),
  Layer.provideMerge(Sessions.layer),
  Layer.provideMerge(ActorDirectory.layer),
)

/**
 * 인증·회사(테넌트)·사용자·역할·약관·초대 컨텍스트의 핸들러 전체입니다. 저장소와 외부 연동 포트는 호출하는 쪽이 넣습니다.
 *
 * 필요한 것: 저장소들, `AuditLog`, `Mailer`, `AccessTokens`, Billing이 구현하는 `CompanyPlans` 포트,
 * Tax가 구현하는 `AgencyWorkload` 포트입니다.
 */
export const IdentityAccessHttpLive = Layer.mergeAll(
  SessionsHttpLive,
  MeHttpLive,
  TermsHttpLive,
  TermAgreementsHttpLive,
  CurrentCompanyHttpLive,
  CompanyRegistrationsHttpLive,
  MembersHttpLive,
  RolesHttpLive,
  InvitationsHttpLive,
  InvitationLinksHttpLive,
  AuditLogsHttpLive,
  AgencyCompaniesHttpLive,
).pipe(Layer.provide(ServicesLive))

const IdentityAccessRepositories = Layer.mergeAll(
  UserRepository.layer(demoUsers()),
  CompanyRepository.layer(demoCompanies()),
  MembershipRepository.layer(demoMemberships()),
  RoleRepository.layer(demoRoles()),
  AgencyAssignmentRepository.layer(demoAssignments()),
  TermRepository.layer(demoTerms(), demoAgreements()),
  InvitationRepository.layer(),
  SessionRepository.layer(),
  AuditLog.layer,
  Mailer.layerMemory,
)

/**
 * 인증·회사(테넌트)·사용자·역할·약관·초대 컨텍스트가 소유한 저장소와 메일 발송 가짜입니다. 표는 `TableFactory`(메모리 또는 SQLite)에 둡니다.
 *
 * 다른 컨텍스트가 쓰는 `CompanyDirectory`도 같은 회사 저장소 위에 만들어 내보냅니다.
 * `CompanyPlans`는 넣지 않습니다. 구독의 원본인 Billing의 저장소 Layer가 넣습니다.
 * `AccessTokens`도 넣지 않습니다. 호출하는 쪽이 넣습니다.
 */
export const IdentityAccessStoreLive = CompanyDirectory.layer.pipe(Layer.provideMerge(IdentityAccessRepositories))

/**
 * {@link IdentityAccessStoreLive}를 메모리 표로 채웁니다. 로컬 개발과 테스트에 씁니다.
 */
export const IdentityAccessMemoryLive = IdentityAccessStoreLive.pipe(Layer.provide(TableFactory.layerMemory))
