import { Result } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { Actor } from '../actor.types.ts'
import type { AuditInput } from '../audit/audit-log.ts'
import type { Membership } from '../members/membership.ts'
import { normalizeBusinessNumber } from './business-number.ts'
import type { BusinessStatus } from './business-status-check.ts'
import {
  BusinessClosed,
  BusinessNumberInvalid,
  CompanyAlreadyRegistered,
  type Company,
  type CompanyPatch,
  type CompanyRegistration,
} from './company.ts'
import { isRegistrationBlocked } from './registration-business-status.ts'

/**
 * 회사 애그리거트입니다(docs/design/domain-model.md). 등록과 수정의 판정 함수(`decide…`)를 둡니다.
 *
 * 판정 함수는 순수 함수입니다. 같은 사업자등록번호의 회사가 있는지(회사 범위를 넘는 불변식, M3)와 사업자 상태조회 결과(바깥 호출, M8)는
 * 서비스가 읽어 넘깁니다. 판정은 남길 감사 기록도 함께 돌려줍니다. 버전 검사(`If-Match`)는 서비스가 맡습니다.
 */

/** 등록할 사업자등록번호입니다. 검증 숫자가 틀리면 `BusinessNumberInvalid`입니다. 서비스는 이 번호로 같은 번호의 회사를 찾습니다. */
export function planCompanyRegistration(
  registration: CompanyRegistration,
): Result.Result<{ businessNumber: string }, BusinessNumberInvalid> {
  const businessNumber = normalizeBusinessNumber(registration.businessNumber)
  return businessNumber === undefined ? Result.fail(new BusinessNumberInvalid({})) : Result.succeed({ businessNumber })
}

/** 만들 회사·소속의 ID와 등록한 사용자, 시각입니다. 서비스가 정합니다. */
export interface CompanyRegistrationInput {
  companyId: Id<'company'>
  membershipId: Id<'membership'>
  userId: Id<'user'>
  at: string
}

/** 등록 판정에 필요한 사실입니다. */
export interface CompanyRegistrationFacts {
  /** 같은 사업자등록번호의 회사가 이미 있는지입니다. */
  alreadyRegistered: boolean
  /**
   * 사업자 상태조회 결과입니다. 조회 실패면 `undefined`입니다. 이미 등록된 번호면 판정이 먼저 거부하므로 서비스는 조회하지 않고
   * `undefined`를 넘깁니다.
   */
  businessStatus: BusinessStatus | undefined
}

/** 등록 결과입니다. 회사와 등록한 사용자의 소유자 소속(관리자)을 함께 만듭니다. */
export interface CompanyRegistrationDecision {
  company: Company
  membership: Membership
  audit: AuditInput[]
}

/**
 * 회사 등록을 판정합니다. 이미 등록된 번호면 `CompanyAlreadyRegistered`, 폐업이면 `BusinessClosed`입니다. 휴업·알 수 없음·조회 실패는
 * 등록합니다. 등록한 사용자는 소유자이고 접근 수준은 관리자로 고정입니다.
 */
export function decideCompanyRegistration(
  input: CompanyRegistrationInput,
  registration: CompanyRegistration,
  businessNumber: string,
  facts: CompanyRegistrationFacts,
): Result.Result<CompanyRegistrationDecision, CompanyAlreadyRegistered | BusinessClosed> {
  if (facts.alreadyRegistered) return Result.fail(new CompanyAlreadyRegistered({}))
  if (isRegistrationBlocked(facts.businessStatus)) return Result.fail(new BusinessClosed({}))
  const company: Company = {
    id: input.companyId,
    name: registration.name,
    businessNumber,
    businessType: registration.businessType,
    ...(registration.phone === undefined ? {} : { phone: registration.phone }),
    representatives: [],
    createdAt: input.at,
    version: 1,
  }
  return Result.succeed({
    company,
    membership: {
      id: input.membershipId,
      companyId: company.id,
      userId: input.userId,
      access: 'ADMIN',
      roleIds: [],
      isOwner: true,
      joinedAt: input.at,
      version: 1,
    },
    audit: [
      {
        action: 'COMPANY_REGISTERED',
        companyId: company.id,
        actorUserId: input.userId,
        actorKind: 'CLIENT',
        targetId: company.id,
      },
    ],
  })
}

/** 회사 수정을 판정합니다. 보낸 필드만 바꾸고 버전을 올리며, 바꾼 필드 이름을 감사 기록에 남깁니다. */
export function decideCompanyUpdate(
  company: Company,
  patch: CompanyPatch,
  actor: Actor,
): { company: Company; audit: AuditInput[] } {
  return {
    company: { ...company, ...patch, version: company.version + 1 },
    audit: [
      {
        action: 'COMPANY_UPDATED',
        companyId: actor.companyId,
        actorUserId: actor.userId,
        actorKind: actor.kind,
        targetId: actor.companyId,
        detail: Object.keys(patch).join(','),
      },
    ],
  }
}
