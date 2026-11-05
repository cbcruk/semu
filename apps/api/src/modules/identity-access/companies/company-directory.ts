import { Context, Effect, Layer, Option } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { BusinessType } from '../actor.types.ts'
import { CompanyRepository } from './company-repository.ts'
import type { Company } from './company.ts'

/** 다른 컨텍스트에 보이는 회사입니다. 연락처·주소 원문은 담지 않습니다. */
export interface DirectoryCompany {
  id: Id<'company'>
  name: string
  /** 하이픈 없는 10자리입니다. */
  businessNumber: string
  businessType: BusinessType
  representativeNames: ReadonlyArray<string>
  /** 시·도 코드입니다. 주소가 없으면 `null`입니다. */
  regionCode: string | null
  /** 업종(자유 입력)입니다. 없으면 `null`입니다. */
  industry: string | null
}

/**
 * 회사(테넌트) 공개 조회입니다. Tax·Integrations처럼 회사 정보가 필요한 컨텍스트는 회사 저장소 대신 이것을 읽습니다.
 *
 * 플랜은 담지 않습니다. 플랜은 `CompanyPlans` 포트(Billing 구현)로 읽습니다.
 */
export class CompanyDirectory extends Context.Service<
  CompanyDirectory,
  {
    find(companyId: Id<'company'>): Effect.Effect<Option.Option<DirectoryCompany>>
    /** 모든 회사입니다. 행위자 없이 도는 일정 배치가 씁니다. */
    list(): Effect.Effect<ReadonlyArray<DirectoryCompany>>
  }
>()('semu/identity-access/CompanyDirectory') {
  /** 회사 저장소로 만듭니다. */
  static readonly layer: Layer.Layer<CompanyDirectory, never, CompanyRepository> = Layer.effect(
    CompanyDirectory,
    Effect.gen(function* () {
      const companies = yield* CompanyRepository
      return CompanyDirectory.of({
        find: (companyId) => companies.findById(companyId).pipe(Effect.map(Option.map(toDirectory))),
        list: () => companies.list().pipe(Effect.map((all) => all.map(toDirectory))),
      })
    }),
  )
}

function toDirectory(company: Company): DirectoryCompany {
  return {
    id: company.id,
    name: company.name,
    businessNumber: company.businessNumber,
    businessType: company.businessType,
    representativeNames: company.representatives.map((representative) => representative.name),
    regionCode: company.regionCode ?? null,
    industry: company.industry ?? null,
  }
}
