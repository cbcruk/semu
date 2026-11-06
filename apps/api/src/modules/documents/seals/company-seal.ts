import { Context, Effect, Layer, Option, Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { makeTenantTable, TableFactory, type TenantTable } from '../../../shared/persistence/record-table.ts'
import { problemType } from '../../../shared/problem/problem.ts'
import { DEMO_COMPANY_IDS } from '../../identity-access/identity-access.public.ts'
import { CompanySealId, FileId } from '../shared/documents-schemas.ts'

/**
 * 회사 도장·사인입니다. 회사마다 따로 있고, 전자서명 요청은 자기 회사 도장만 고를 수 있습니다.
 *
 * 이미지는 파일 저장소에 먼저 올리고 그 파일 ID(`imageFileId`)로 등록합니다. 서명 이미지와 같은 방식입니다.
 */
export interface CompanySealRecord {
  id: Id<'companySeal'>
  companyId: Id<'company'>
  name: string
  source: 'UPLOAD' | 'DRAWN'
  imageFileId: Id<'file'>
  /** 소프트 삭제 시각입니다. 지운 도장은 새 요청에 고를 수 없고 한도에도 세지 않습니다. */
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
    imageFileId: 'fle_01JBQ000000000000000000001' as Id<'file'>,
    createdAt: '2026-01-02T00:00:00.000Z',
  },
]

/** 도장 응답입니다. */
export const CompanySeal = Schema.Struct({
  id: CompanySealId,
  name: Schema.String,
  source: Schema.Literals(['UPLOAD', 'DRAWN']),
  imageFileId: FileId,
  createdAt: Schema.String,
})
export type CompanySeal = typeof CompanySeal.Type

/** 도장 이름의 최대 길이입니다. 다른 컨텍스트의 이름 필드(상담 신청자·거래처 대표자 이름)와 같은 50자입니다. */
export const COMPANY_SEAL_NAME_MAX_LENGTH = 50

/** 도장 등록 요청입니다. 현행은 이미지를 multipart로 받았고, 재설계는 먼저 올린 파일 ID를 받습니다. */
export const CompanySealRegistration = Schema.Struct({
  name: Schema.NonEmptyString.check(Schema.isMaxLength(COMPANY_SEAL_NAME_MAX_LENGTH)),
  source: Schema.Literals(['UPLOAD', 'DRAWN']),
  imageFileId: FileId,
})

/** 도장이 없거나 다른 회사 도장입니다. */
export class CompanySealNotFound extends HttpApiError.Problem<CompanySealNotFound>()(
  'CompanySealNotFound',
  { type: problemType('COMPANY_SEAL_NOT_FOUND'), status: 404, title: 'Company seal not found' },
  { code: Schema.tag('COMPANY_SEAL_NOT_FOUND') },
) {}

/** 회사당 도장 한도(5개)를 넘었습니다. */
export class CompanySealLimitExceeded extends HttpApiError.Problem<CompanySealLimitExceeded>()(
  'CompanySealLimitExceeded',
  { type: problemType('COMPANY_SEAL_LIMIT_EXCEEDED'), status: 409, title: 'Too many company seals' },
  { code: Schema.tag('COMPANY_SEAL_LIMIT_EXCEEDED') },
) {}

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
