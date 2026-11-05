import { Context, Effect, Layer, Option } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { makeTenantTable, TableFactory, type TenantTable } from '../../../shared/persistence/record-table.ts'
import { DEMO_COMPANY_IDS } from '../../identity-access/identity-access.public.ts'

/**
 * 회사 도장·사인입니다. 회사마다 따로 있고, 전자서명 요청은 자기 회사 도장만 고를 수 있습니다.
 *
 * 이미지 업로드·삭제 API(`/company-seals`)는 아직 없습니다. 지금은 요청에 고른 도장이 그 회사 것인지 확인하는 데만 씁니다.
 */
export interface CompanySealRecord {
  id: Id<'companySeal'>
  companyId: Id<'company'>
  name: string
  source: 'UPLOAD' | 'DRAWN'
  /** 소프트 삭제 시각입니다. 지운 도장은 새 요청에 고를 수 없습니다. */
  deletedAt?: string | undefined
  createdAt: string
}

/** 데모 회사(법인)의 도장입니다. */
export const DEMO_COMPANY_SEALS: ReadonlyArray<CompanySealRecord> = [
  {
    id: 'sel_01JBQ000000000000000000001' as Id<'companySeal'>,
    companyId: DEMO_COMPANY_IDS.corporation,
    name: '법인 인감',
    source: 'UPLOAD',
    createdAt: '2026-01-02T00:00:00.000Z',
  },
]

/** 회사 도장 저장소입니다. */
export class CompanySealRepository extends Context.Service<
  CompanySealRepository,
  TenantTable<CompanySealRecord> & {
    /** `companyId`의 지우지 않은 도장입니다. 다른 회사 도장이면 `None`입니다. */
    findActive(companyId: Id<'company'>, id: string): Effect.Effect<Option.Option<CompanySealRecord>>
  }
>()('semu/documents/CompanySealRepository') {
  /** `documents_company_seals` 표에 둡니다. 표가 비어 있으면 `seed`로 시작합니다. 저장 방식은 {@link TableFactory}가 정합니다. */
  static readonly layer = (seed: ReadonlyArray<CompanySealRecord> = DEMO_COMPANY_SEALS) =>
    Layer.effect(
      CompanySealRepository,
      Effect.gen(function* () {
        const table = yield* makeTenantTable<CompanySealRecord>('documents_company_seals', seed)
        return CompanySealRepository.of({
          ...table,
          findActive: (companyId, id) =>
            Effect.map(
              table.find(companyId, id),
              Option.filter((seal) => seal.deletedAt === undefined),
            ),
        })
      }),
    )

  /** 프로세스 메모리에 도장을 둡니다. */
  static readonly layerMemory = (seed: ReadonlyArray<CompanySealRecord> = DEMO_COMPANY_SEALS) =>
    CompanySealRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}
