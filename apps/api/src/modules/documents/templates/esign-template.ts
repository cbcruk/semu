import { Context, Effect, Layer, Option, Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { problemType } from '../../../shared/problem/problem.ts'
import type { TemplateField } from '../esign/esign-send-validation.types.ts'
import { EsignTemplateId, FileId } from '../shared/documents-schemas.ts'

/** 템플릿이 만드는 문서 종류입니다. 증명서 종류는 제증명 발급에만 씁니다. */
export const DocumentKind = Schema.Literals([
  'EMPLOYMENT_CONTRACT',
  'SALARY_CONTRACT',
  'EMPLOYMENT_CERTIFICATE',
  'CAREER_CERTIFICATE',
  'RETIREMENT_CERTIFICATE',
])

/** 템플릿 필드 응답입니다. */
export const TemplateFieldView = Schema.Struct({
  key: Schema.String,
  label: Schema.String,
  type: Schema.Literals(['TEXT', 'TEXTAREA', 'DATE', 'NUMBER', 'MONEY', 'SELECT']),
  required: Schema.Boolean,
  hideable: Schema.Boolean,
  signer: Schema.Boolean,
  source: Schema.optionalKey(Schema.String),
})

/** 전자서명·제증명 템플릿 응답입니다. */
export const EsignTemplate = Schema.Struct({
  id: EsignTemplateId,
  title: Schema.String,
  kind: DocumentKind,
  isActive: Schema.Boolean,
  defaultCompanySealId: Schema.optionalKey(FileId),
  fields: Schema.Array(TemplateFieldView),
})

/** 템플릿 응답의 타입입니다. */
export type EsignTemplate = typeof EsignTemplate.Type

/** 저장하는 템플릿입니다. 기본 템플릿은 모든 회사가 같이 씁니다. */
export interface EsignTemplateRecord {
  id: Id<'esignTemplate'>
  title: string
  kind: typeof DocumentKind.Type
  isActive: boolean
  defaultCompanySealId?: Id<'file'> | undefined
  fields: ReadonlyArray<TemplateField>
}

const field = (key: string, label: string, overrides: Partial<TemplateField> = {}): TemplateField => ({
  key,
  label,
  type: 'TEXT',
  required: true,
  hideable: false,
  signer: false,
  ...overrides,
})

/** 기본 템플릿입니다. 현행 기본 템플릿 중 근로·연봉계약서와 증명서 셋을 옮겼습니다. */
export const BASE_TEMPLATES: ReadonlyArray<EsignTemplateRecord> = [
  {
    id: 'est_01JBQ0000000000000000000C1' as Id<'esignTemplate'>,
    title: '근로계약서(정규직, 5인 이상)',
    kind: 'EMPLOYMENT_CONTRACT',
    isActive: true,
    fields: [
      field('employeeName', '근로자 성명', { source: 'employee.name' }),
      field('startDate', '근로개시일', { type: 'DATE', source: 'employee.joinDate' }),
      field('workPlace', '근무 장소'),
      field('jobDescription', '업무 내용', { type: 'TEXTAREA' }),
      field('bonusClause', '상여금 조항', { required: false, hideable: true }),
      field('signerAddress', '근로자 주소', { signer: true }),
    ],
  },
  {
    id: 'est_01JBQ0000000000000000000C2' as Id<'esignTemplate'>,
    title: '연봉계약서',
    kind: 'SALARY_CONTRACT',
    isActive: true,
    fields: [
      field('employeeName', '근로자 성명', { source: 'employee.name' }),
      field('annualSalary', '연봉', { type: 'MONEY' }),
      field('effectiveDate', '적용 시작일', { type: 'DATE' }),
    ],
  },
  {
    id: 'est_01JBQ0000000000000000000E1' as Id<'esignTemplate'>,
    title: '재직증명서',
    kind: 'EMPLOYMENT_CERTIFICATE',
    isActive: true,
    fields: [field('purpose', '용도')],
  },
  {
    id: 'est_01JBQ0000000000000000000E2' as Id<'esignTemplate'>,
    title: '경력증명서',
    kind: 'CAREER_CERTIFICATE',
    isActive: true,
    fields: [field('purpose', '용도')],
  },
  {
    id: 'est_01JBQ0000000000000000000E3' as Id<'esignTemplate'>,
    title: '퇴직증명서',
    kind: 'RETIREMENT_CERTIFICATE',
    isActive: true,
    fields: [field('purpose', '용도')],
  },
]

/** 템플릿 저장소입니다. 회사별 덮어쓰기(문구·기본 도장·사용 여부)는 아직 없습니다. */
export class EsignTemplateRepository extends Context.Service<
  EsignTemplateRepository,
  {
    list(): Effect.Effect<ReadonlyArray<EsignTemplateRecord>>
    find(id: string): Effect.Effect<Option.Option<EsignTemplateRecord>>
  }
>()('semu/documents/EsignTemplateRepository') {
  /** 기본 템플릿을 메모리에 둡니다. */
  static readonly layerMemory = (templates: ReadonlyArray<EsignTemplateRecord> = BASE_TEMPLATES) =>
    Layer.succeed(
      EsignTemplateRepository,
      EsignTemplateRepository.of({
        list: () => Effect.succeed(templates),
        find: (id) => Effect.succeed(Option.fromNullishOr(templates.find((template) => template.id === id))),
      }),
    )
}

/** 템플릿이 없습니다. */
export class EsignTemplateNotFound extends HttpApiError.Problem<EsignTemplateNotFound>()(
  'EsignTemplateNotFound',
  { type: problemType('ESIGN_TEMPLATE_NOT_FOUND'), status: 404, title: 'Template not found' },
  { code: Schema.tag('ESIGN_TEMPLATE_NOT_FOUND') },
) {}
