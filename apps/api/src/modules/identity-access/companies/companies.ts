import { Clock, Context, Effect, Layer, Option } from 'effect'
import { checkVersion } from '../../../shared/http/versioning.ts'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { VersionMismatch } from '../../../shared/problem/problem.ts'
import type { Actor } from '../actor.types.ts'
import { AuditLog } from '../audit/audit-log.ts'
import { MembershipRepository } from '../members/membership-repository.ts'
import { describeDefect } from '../../../shared/problem/defect-log.ts'
import { normalizeBusinessNumber } from './business-number.ts'
import { BusinessStatusCheck } from './business-status-check.ts'
import { CompanyRepository } from './company-repository.ts'
import { BusinessClosed, BusinessNumberInvalid, CompanyAlreadyRegistered } from './company.ts'
import type { Company, CompanyPatch, CompanyRegistration } from './company.ts'
import { isRegistrationBlocked } from './registration-business-status.ts'

/** 지금 회사(테넌트) 조회·수정과 새 회사 등록입니다. */
export class Companies extends Context.Service<
  Companies,
  {
    /** 행위자의 회사입니다. 토큰이 회사에 묶이므로 항상 있습니다. */
    current(actor: Actor): Effect.Effect<Company>
    update(
      actor: Actor,
      patch: CompanyPatch,
      expectedVersion: number | undefined,
    ): Effect.Effect<Company, VersionMismatch>
    /**
     * 회사를 등록하고 등록한 사용자를 소유자(관리자)로 넣습니다. 그 회사의 토큰은 `:switch-company`로 받습니다.
     *
     * 사업자등록번호 검증 숫자가 틀리면 422, 이미 등록된 번호면 409입니다. 그다음 사업자 상태를 조회해 폐업이면 422
     * `BUSINESS_CLOSED`입니다. 휴업·알 수 없음·조회 실패는 등록합니다.
     */
    register(
      userId: Id<'user'>,
      registration: CompanyRegistration,
    ): Effect.Effect<Company, BusinessNumberInvalid | CompanyAlreadyRegistered | BusinessClosed>
  }
>()('semu/identity-access/Companies') {
  static readonly layer = Layer.effect(
    Companies,
    Effect.gen(function* () {
      const companies = yield* CompanyRepository
      const memberships = yield* MembershipRepository
      const audit = yield* AuditLog
      const businessStatuses = yield* BusinessStatusCheck

      /** 조회 실패(결함)는 로그만 남기고 `undefined`로 넘깁니다. 외부 API 장애가 가입을 막지 않게 합니다. */
      const businessStatusOf = (businessNumber: string) =>
        businessStatuses
          .statusOf(businessNumber)
          .pipe(
            Effect.catchDefect((defect) =>
              Effect.logWarning('Business status lookup failed', describeDefect(defect)).pipe(Effect.as(undefined)),
            ),
          )

      const current = Effect.fn('Companies.current')(function* (actor: Actor) {
        return yield* companies.findById(actor.companyId).pipe(Effect.flatMap(Effect.fromOption), Effect.orDie)
      })

      const update = Effect.fn('Companies.update')(function* (
        actor: Actor,
        patch: CompanyPatch,
        expectedVersion: number | undefined,
      ) {
        const company = yield* current(actor)
        yield* checkVersion(company.version, expectedVersion)
        const next: Company = { ...company, ...patch, version: company.version + 1 }
        yield* companies.save(next)
        yield* audit.record({
          action: 'COMPANY_UPDATED',
          companyId: actor.companyId,
          actorUserId: actor.userId,
          actorKind: actor.kind,
          targetId: actor.companyId,
          detail: Object.keys(patch).join(','),
        })
        return next
      })

      const register = Effect.fn('Companies.register')(function* (
        userId: Id<'user'>,
        registration: CompanyRegistration,
      ) {
        const businessNumber = normalizeBusinessNumber(registration.businessNumber)
        if (businessNumber === undefined) return yield* new BusinessNumberInvalid({})
        if (Option.isSome(yield* companies.findByBusinessNumber(businessNumber))) {
          return yield* new CompanyAlreadyRegistered({})
        }
        if (isRegistrationBlocked(yield* businessStatusOf(businessNumber))) return yield* new BusinessClosed({})
        const now = yield* Clock.currentTimeMillis
        const nowIso = new Date(now).toISOString()
        const company: Company = {
          id: newId('company', now),
          name: registration.name,
          businessNumber,
          businessType: registration.businessType,
          ...(registration.phone === undefined ? {} : { phone: registration.phone }),
          representatives: [],
          createdAt: nowIso,
          version: 1,
        }
        yield* companies.save(company)
        yield* memberships.save({
          id: newId('membership', now),
          companyId: company.id,
          userId,
          access: 'ADMIN',
          roleIds: [],
          isOwner: true,
          joinedAt: nowIso,
          version: 1,
        })
        yield* audit.record({
          action: 'COMPANY_REGISTERED',
          companyId: company.id,
          actorUserId: userId,
          actorKind: 'CLIENT',
          targetId: company.id,
        })
        return company
      })

      return Companies.of({ current, update, register })
    }),
  )
}
