import { Layer } from 'effect'
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
import { InvitationRepository } from './invitations/invitation-repository.ts'

const ServicesLive = Layer.mergeAll(Terms.layer, MeService.layer).pipe(
  Layer.provideMerge(Sessions.layer),
  Layer.provideMerge(ActorDirectory.layer),
)

/**
 * 인증·회사(테넌트)·사용자·역할·약관·초대 컨텍스트의 핸들러 전체입니다. 저장소와 외부 연동 포트는 호출하는 쪽이 넣습니다.
 *
 * 필요한 것: 저장소들, `AuditLog`, `Mailer`, `AccessTokens`, 그리고 Billing이 구현하는 `CompanyPlans` 포트입니다.
 */
export const IdentityAccessHttpLive = Layer.mergeAll(
  SessionsHttpLive,
  MeHttpLive,
  TermsHttpLive,
  TermAgreementsHttpLive,
).pipe(Layer.provide(ServicesLive))

/**
 * 인증·회사(테넌트)·사용자·역할·약관·초대 컨텍스트의 저장소·외부 연동을 메모리 구현과 결정적인 가짜로 채웁니다. 로컬 개발과 테스트에 씁니다.
 *
 * `CompanyPlans`는 넣지 않습니다. 구독의 원본인 Billing의 메모리 Layer가 넣습니다.
 */
export const IdentityAccessMemoryLive = Layer.mergeAll(
  UserRepository.layerMemory(demoUsers()),
  CompanyRepository.layerMemory(demoCompanies()),
  MembershipRepository.layerMemory(demoMemberships()),
  RoleRepository.layerMemory(demoRoles()),
  AgencyAssignmentRepository.layerMemory(demoAssignments()),
  TermRepository.layerMemory(demoTerms(), demoAgreements()),
  InvitationRepository.layerMemory(),
  SessionRepository.layerMemory(),
  AuditLog.layerMemory,
  Mailer.layerMemory,
)
