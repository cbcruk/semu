import { Result } from 'effect'
import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { testActor } from '../testing.ts'
import { decideCompanyRegistration, decideCompanyUpdate, planCompanyRegistration } from './company.aggregate.ts'

const registration = { name: '새 회사', businessNumber: '220-81-62517', businessType: 'CORPORATION' as const }
const input = {
  companyId: 'cmp_01JBQ00000000000000000000N' as Id<'company'>,
  membershipId: 'mbr_01JBQ00000000000000000000N' as Id<'membership'>,
  userId: 'usr_01JBQ000000000000000000001' as Id<'user'>,
  at: '2026-11-15T00:00:00.000Z',
}

describe('planCompanyRegistration', () => {
  it('검증 숫자가 맞으면 하이픈을 뺀 번호를, 틀리면 사업자등록번호 오류를 돌려줍니다', () => {
    expect(Result.getOrThrow(planCompanyRegistration(registration))).toEqual({ businessNumber: '2208162517' })
    const invalid = planCompanyRegistration({ ...registration, businessNumber: '220-81-62518' })

    expect(Result.isFailure(invalid) && invalid.failure._tag).toBe('BusinessNumberInvalid')
  })
})

describe('decideCompanyRegistration', () => {
  it('회사와 등록한 사용자의 소유자 관리자 소속을 함께 만들고 등록 감사 기록을 남깁니다', () => {
    const decision = Result.getOrThrow(
      decideCompanyRegistration(input, registration, '2208162517', {
        alreadyRegistered: false,
        businessStatus: 'SUSPENDED',
      }),
    )

    expect(decision.company).toMatchObject({ id: input.companyId, businessNumber: '2208162517', version: 1 })
    expect(decision.company).not.toHaveProperty('phone')
    expect(decision.membership).toMatchObject({
      companyId: input.companyId,
      userId: input.userId,
      access: 'ADMIN',
      isOwner: true,
    })
    expect(decision.audit).toEqual([
      {
        action: 'COMPANY_REGISTERED',
        companyId: input.companyId,
        actorUserId: input.userId,
        actorKind: 'CLIENT',
        targetId: input.companyId,
      },
    ])
  })

  it('이미 등록된 번호는 상태조회보다 먼저, 폐업은 그다음에 거부합니다', () => {
    const taken = decideCompanyRegistration(input, registration, '2208162517', {
      alreadyRegistered: true,
      businessStatus: 'CLOSED',
    })
    const closed = decideCompanyRegistration(input, registration, '2208162517', {
      alreadyRegistered: false,
      businessStatus: 'CLOSED',
    })

    expect(Result.isFailure(taken) && taken.failure._tag).toBe('CompanyAlreadyRegistered')
    expect(Result.isFailure(closed) && closed.failure._tag).toBe('BusinessClosed')
  })

  it('상태조회가 실패했으면 등록합니다', () => {
    expect(
      Result.isSuccess(
        decideCompanyRegistration(input, registration, '2208162517', {
          alreadyRegistered: false,
          businessStatus: undefined,
        }),
      ),
    ).toBe(true)
  })
})

describe('decideCompanyUpdate', () => {
  it('보낸 필드만 바꾸고 버전을 올리며 바꾼 필드 이름을 감사 기록에 남깁니다', () => {
    const actor = testActor()
    const company = {
      id: actor.companyId,
      name: '옛 이름',
      businessNumber: '2208162517',
      businessType: 'CORPORATION' as const,
      representatives: [],
      createdAt: input.at,
      version: 3,
    }
    const decision = decideCompanyUpdate(company, { phone: '02-000-0000', industry: '도소매' }, actor)

    expect(decision.company).toMatchObject({ name: '옛 이름', phone: '02-000-0000', industry: '도소매', version: 4 })
    expect(decision.audit[0]).toMatchObject({
      action: 'COMPANY_UPDATED',
      detail: 'phone,industry',
      targetId: actor.companyId,
    })
  })
})
