import { Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import { IdSchema } from '../../../shared/ids/id-schema.ts'
import { problemType } from '../../../shared/problem/problem.ts'

/** 신고 건 ID입니다. 예: `fil_01J...` */
export const FilingId = IdSchema('filing')

/** 파일 저장소의 파일 ID입니다. 예: `fle_01J...` */
export const FileId = IdSchema('file')

/** 신고 건 문서 ID입니다. 예: `fdc_01J...` */
export const FilingDocumentId = IdSchema('filingDocument')

/** 세목입니다. */
export const TaxType = Schema.Literals(['VAT', 'WITHHOLDING_TAX', 'CORPORATE_TAX', 'INCOME_TAX'])

/** 신고 건 주기·종류입니다. */
export const FilingKind = Schema.Literals([
  'PRELIMINARY',
  'FINAL',
  'NOTICE',
  'MONTHLY',
  'SEMIANNUAL',
  'INTERIM',
  'ANNUAL',
])

/** 신고 건 상태입니다. */
export const FilingStatus = Schema.Literals([
  'SCHEDULED',
  'REQUESTED',
  'SUBMITTED',
  'REVIEWING',
  'LEDGER_PENDING',
  'PREPARING',
  'FILED',
  'SETTLED',
  'CANCELED',
])

/** 신고 건 커맨드입니다. */
export const FilingCommand = Schema.Literals([
  'REQUEST',
  'SUBMIT',
  'UNSUBMIT',
  'START_REVIEW',
  'REJECT',
  'UPLOAD_LEDGER',
  'CONFIRM_LEDGER',
  'DISPUTE_LEDGER',
  'START_PREPARING',
  'FILE',
  'RECORD_NOTICE',
  'PAY',
  'CLOSE',
  'CANCEL',
])

/** 제출 자료 항목 코드입니다. */
export const RequirementCode = Schema.Literals([
  'PG_ONLINE_SALES',
  'EXPORT_FX',
  'PAPER_TAX_INVOICE',
  'SIMPLE_RECEIPT',
  'ENDING_INVENTORY',
  'DEPOSIT_FUND_ACCOUNTS',
  'PAYROLL_LEDGER_CLOSED',
  'BUSINESS_INCOME',
  'OTHER_INCOME',
  'DAILY_WAGE',
  'RETIREMENT_INCOME',
  'INTEREST_DIVIDEND',
  'UNREFLECTED_BONUS',
])

/** 제출 자료 응답입니다. */
export const RequirementResponse = Schema.Literals(['PENDING', 'PROVIDED', 'NOT_APPLICABLE'])

/** 대리인 문서 종류입니다. */
export const FilingDocumentType = Schema.Literals(['LEDGER', 'RETURN', 'PAYMENT_SLIP', 'NOTICE'])

/** 제출 자료 항목입니다. 자동 연계 항목은 고객이 고칠 수 없습니다. */
export const Requirement = Schema.Struct({
  code: RequirementCode,
  response: RequirementResponse,
  autoLinked: Schema.Boolean,
  note: Schema.NullOr(Schema.String),
  fileIds: Schema.Array(FileId),
  updatedAt: Schema.NullOr(Schema.String),
})

/** 신고 건 문서입니다. 고객에게는 지금 상태에서 볼 수 있고 바뀌지 않은 문서만 보입니다. */
export const FilingDocument = Schema.Struct({
  id: FilingDocumentId,
  type: FilingDocumentType,
  fileId: FileId,
  createdAt: Schema.String,
  firstViewedAt: Schema.NullOr(Schema.String),
  replacedAt: Schema.NullOr(Schema.String),
})

/** 진행 막대의 단계와 위치입니다. */
export const FilingProgress = Schema.Struct({
  stage: Schema.NullOr(
    Schema.Literals(['MATERIALS_OPEN', 'UNDER_REVIEW', 'LEDGER_CONFIRMATION', 'PREPARING', 'PAYMENT', 'CLOSED']),
  ),
  index: Schema.Int,
  count: Schema.Int,
})

const filingFields = {
  id: FilingId,
  taxType: TaxType,
  kind: FilingKind,
  /** 세목·종류 안의 기간 이름입니다. 예: `2026-H2`, `2026-10`, `2026` */
  periodKey: Schema.String,
  /** 수정신고면 1 이상입니다. */
  revision: Schema.Int,
  periodStart: Schema.String,
  periodEnd: Schema.String,
  statutoryDue: Schema.NullOr(Schema.String),
  dueDate: Schema.NullOr(Schema.String),
  paymentDue: Schema.NullOr(Schema.String),
  submitDue: Schema.NullOr(Schema.String),
  status: FilingStatus,
  /** 신고서를 내기 전인데 기한이 지났는지입니다. 회사 시간대 오늘로 계산합니다. */
  isOverdue: Schema.Boolean,
  progress: FilingProgress,
  /** 납부할 세액(원)입니다. 음수는 환급입니다. */
  payableAmount: Schema.NullOr(Schema.Int),
  settlement: Schema.NullOr(Schema.Literals(['PAID', 'REFUND', 'NO_PAYMENT'])),
  paidOn: Schema.NullOr(Schema.String),
  ledgerUploadedAt: Schema.NullOr(Schema.String),
  ledgerConfirmedAt: Schema.NullOr(Schema.String),
  ledgerDisputeCount: Schema.Int,
  paymentSlipSentAt: Schema.NullOr(Schema.String),
  version: Schema.Int,
  updatedAt: Schema.String,
}

/** 신고 건 목록 항목입니다. */
export const FilingSummary = Schema.Struct(filingFields)

export type FilingSummary = typeof FilingSummary.Type

/** 신고 건 상세입니다. 제출 자료, 볼 수 있는 문서, 지금 보낼 수 있는 커맨드를 함께 줍니다. */
export const Filing = Schema.Struct({
  ...filingFields,
  requirements: Schema.Array(Requirement),
  documents: Schema.Array(FilingDocument),
  allowedActions: Schema.Array(FilingCommand),
})

export type Filing = typeof Filing.Type

/** 신고 건 이력 한 줄입니다. */
export const FilingHistoryEntry = Schema.Struct({
  type: Schema.String,
  actorKind: Schema.Literals(['CLIENT', 'AGENCY', 'SYSTEM']),
  /** 대리인이 고객 대신 한 일(고객 커맨드 대행, 제출 자료 응답·파일)이면 `CLIENT`입니다. 그 밖에는 키가 없습니다. */
  onBehalfOf: Schema.optionalKey(Schema.Literal('CLIENT')),
  fromStatus: Schema.NullOr(FilingStatus),
  toStatus: Schema.NullOr(FilingStatus),
  detail: Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Number])),
  occurredAt: Schema.String,
})

/** 요청한 ID의 신고 건이 없습니다. 다른 회사의 신고 건도 없는 것으로 봅니다. */
export class FilingNotFound extends HttpApiError.Problem<FilingNotFound>()(
  'FilingNotFound',
  { type: problemType('FILING_NOT_FOUND'), status: 404, title: 'Filing not found' },
  { code: Schema.tag('FILING_NOT_FOUND') },
) {}

/** 신고 건의 현재 상태·세목·종류·세액에서는 이 커맨드를 보낼 수 없습니다. */
export class FilingTransitionInvalid extends HttpApiError.Problem<FilingTransitionInvalid>()(
  'FilingTransitionInvalid',
  { type: problemType('FILING_TRANSITION_INVALID'), status: 409, title: 'Filing status does not allow this command' },
  { code: Schema.tag('FILING_TRANSITION_INVALID'), currentStatus: FilingStatus, command: FilingCommand },
) {}

/** 이 커맨드는 다른 행위자(고객 또는 세무 대리인)의 일입니다. */
export class FilingActorNotAllowed extends HttpApiError.Problem<FilingActorNotAllowed>()(
  'FilingActorNotAllowed',
  { type: problemType('FILING_ACTOR_NOT_ALLOWED'), status: 403, title: 'Command belongs to another actor' },
  {
    code: Schema.tag('FILING_ACTOR_NOT_ALLOWED'),
    /** 커맨드 이름이거나, 커맨드가 아닌 쓰기면 `ADD_DOCUMENT`입니다. */
    action: Schema.String,
    requiredActorKind: Schema.Literals(['CLIENT', 'AGENCY']),
  },
) {}

/** 아직 답하지 않은 제출 자료 항목이 있어 제출할 수 없습니다. */
export class FilingRequirementsPending extends HttpApiError.Problem<FilingRequirementsPending>()(
  'FilingRequirementsPending',
  { type: problemType('FILING_REQUIREMENTS_PENDING'), status: 422, title: 'Requirements are still pending' },
  { code: Schema.tag('FILING_REQUIREMENTS_PENDING'), requirementCodes: Schema.Array(RequirementCode) },
) {}

/**
 * 지금 상태에서는 신고 건의 자료·문서를 바꿀 수 없습니다.
 *
 * 제출 자료는 `REQUESTED`에서만, 대리인 문서(신고서·납부서)는 `PREPARING`·`FILED`에서만 바꿉니다.
 */
export class FilingLocked extends HttpApiError.Problem<FilingLocked>()(
  'FilingLocked',
  { type: problemType('FILING_LOCKED'), status: 409, title: 'Filing does not accept this change in its status' },
  { code: Schema.tag('FILING_LOCKED'), currentStatus: FilingStatus },
) {}

/** 신고 건에 이 코드의 제출 자료 항목이 없습니다. */
export class RequirementNotFound extends HttpApiError.Problem<RequirementNotFound>()(
  'RequirementNotFound',
  { type: problemType('REQUIREMENT_NOT_FOUND'), status: 404, title: 'Requirement not found' },
  { code: Schema.tag('REQUIREMENT_NOT_FOUND') },
) {}

/** 다른 컨텍스트의 사실로 정해지는 항목이라 고객이 고칠 수 없습니다. */
export class RequirementAutoLinked extends HttpApiError.Problem<RequirementAutoLinked>()(
  'RequirementAutoLinked',
  { type: problemType('REQUIREMENT_AUTO_LINKED'), status: 409, title: 'Requirement is linked automatically' },
  { code: Schema.tag('REQUIREMENT_AUTO_LINKED') },
) {}

/** 파일이 붙은 항목은 해당 없음으로 바꿀 수 없습니다. 파일을 먼저 뗍니다. */
export class RequirementHasFiles extends HttpApiError.Problem<RequirementHasFiles>()(
  'RequirementHasFiles',
  { type: problemType('REQUIREMENT_HAS_FILES'), status: 422, title: 'Requirement still has files' },
  { code: Schema.tag('REQUIREMENT_HAS_FILES') },
) {}

/** 항목에 그 파일이 붙어 있지 않습니다. */
export class RequirementFileNotFound extends HttpApiError.Problem<RequirementFileNotFound>()(
  'RequirementFileNotFound',
  { type: problemType('REQUIREMENT_FILE_NOT_FOUND'), status: 404, title: 'Requirement file not found' },
  { code: Schema.tag('REQUIREMENT_FILE_NOT_FOUND') },
) {}

/** 요청한 문서가 없거나, 고객이 지금 상태에서 볼 수 없는 문서입니다. */
export class FilingDocumentNotFound extends HttpApiError.Problem<FilingDocumentNotFound>()(
  'FilingDocumentNotFound',
  { type: problemType('FILING_DOCUMENT_NOT_FOUND'), status: 404, title: 'Filing document not found' },
  { code: Schema.tag('FILING_DOCUMENT_NOT_FOUND') },
) {}
