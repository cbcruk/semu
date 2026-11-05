import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { Page, PageQueryFields } from '../../../shared/http/pagination.ts'
import {
  EntitlementRequired,
  PermissionDenied,
  TermsReagreementRequired,
  VersionMismatch,
} from '../../../shared/problem/problem.ts'
import { Authentication } from '../../identity-access/authentication.ts'
import {
  CalendarDate,
  FileId,
  Filing,
  FilingActorNotAllowed,
  FilingDocument,
  FilingDocumentId,
  FilingDocumentNotFound,
  FilingHistoryEntry,
  FilingId,
  FilingLocked,
  FilingNotFound,
  FilingRequirementsPending,
  FilingStatus,
  FilingSummary,
  FilingTransitionInvalid,
  RequirementAutoLinked,
  RequirementCode,
  RequirementFileNotFound,
  RequirementHasFiles,
  RequirementNotFound,
  TaxType,
} from './filing.ts'

const params = { filingId: FilingId }
/** 다른 사람의 변경을 덮어쓰지 않도록 보내는 버전입니다. 예: `"7"`. 없으면 검사하지 않습니다. */
const headers = { 'if-match': Schema.optionalKey(Schema.String) }
/** 바뀐 신고 건과, 다음 요청의 `If-Match`에 쓸 `ETag`입니다. */
const success = HttpApiSchema.WithHeaders(Filing, { etag: Schema.String })
const accessErrors = [PermissionDenied, EntitlementRequired, TermsReagreementRequired]
const commandErrors = [...accessErrors, FilingNotFound, FilingTransitionInvalid, FilingActorNotAllowed, VersionMismatch]
const requirementErrors = [
  ...accessErrors,
  FilingNotFound,
  FilingLocked,
  RequirementNotFound,
  RequirementAutoLinked,
  RequirementHasFiles,
  RequirementFileNotFound,
]
const Reason = Schema.NonEmptyString
const requirementParams = { filingId: FilingId, code: RequirementCode }

/**
 * 세무 신고 건입니다. 고객과 세무 대리인이 같은 경로를 쓰고, 커맨드마다 할 수 있는 행위자가 정해져 있습니다.
 *
 * 커맨드는 `POST /filings/{filingId}:{command}`입니다. 라우터는 `::`를 콜론 문자로 읽습니다.
 */
export class FilingsApi extends HttpApiGroup.make('filings')
  .add(
    HttpApiEndpoint.get('list', '/', {
      query: Schema.Struct({
        ...PageQueryFields,
        taxType: Schema.optionalKey(TaxType),
        status: Schema.optionalKey(FilingStatus),
        /** `true`면 끝나지 않은 신고 건만, `false`면 끝난 신고 건만입니다. */
        open: Schema.optionalKey(Schema.Literals(['true', 'false'])),
      }),
      success: Page(FilingSummary),
      error: accessErrors,
    }),
    HttpApiEndpoint.get('get', '/:filingId', { params, success, error: [...accessErrors, FilingNotFound] }),
    HttpApiEndpoint.get('history', '/:filingId/history', {
      params,
      success: Schema.Struct({ items: Schema.Array(FilingHistoryEntry) }),
      error: [...accessErrors, FilingNotFound],
    }),
    HttpApiEndpoint.post('request', '/:filingId::request', {
      params,
      headers,
      payload: Schema.Struct({ submitDue: CalendarDate, message: Schema.optionalKey(Schema.String) }),
      success,
      error: commandErrors,
    }),
    HttpApiEndpoint.post('submit', '/:filingId::submit', {
      params,
      headers,
      success,
      error: [...commandErrors, FilingRequirementsPending],
    }),
    HttpApiEndpoint.post('unsubmit', '/:filingId::unsubmit', { params, headers, success, error: commandErrors }),
    HttpApiEndpoint.post('startReview', '/:filingId::start-review', { params, headers, success, error: commandErrors }),
    HttpApiEndpoint.post('reject', '/:filingId::reject', {
      params,
      headers,
      payload: Schema.Struct({ reason: Reason, submitDue: CalendarDate }),
      success,
      error: commandErrors,
    }),
    HttpApiEndpoint.post('uploadLedger', '/:filingId::upload-ledger', {
      params,
      headers,
      payload: Schema.Struct({ ledgerFileId: FileId }),
      success,
      error: commandErrors,
    }),
    HttpApiEndpoint.post('confirmLedger', '/:filingId::confirm-ledger', {
      params,
      headers,
      success,
      error: commandErrors,
    }),
    HttpApiEndpoint.post('disputeLedger', '/:filingId::dispute-ledger', {
      params,
      headers,
      payload: Schema.Struct({ reason: Reason }),
      success,
      error: commandErrors,
    }),
    HttpApiEndpoint.post('startPreparing', '/:filingId::start-preparing', {
      params,
      headers,
      success,
      error: commandErrors,
    }),
    HttpApiEndpoint.post('file', '/:filingId::file', {
      params,
      headers,
      payload: Schema.Struct({
        /** 납부할 세액(원)입니다. 음수는 환급, 0은 납부 없음입니다. */
        payableAmount: Schema.Int,
        /** 없으면 신고 기한을 씁니다. */
        paymentDue: Schema.optionalKey(CalendarDate),
        returnFileId: FileId,
        paymentSlipFileId: Schema.optionalKey(FileId),
      }),
      success,
      error: commandErrors,
    }),
    HttpApiEndpoint.post('recordNotice', '/:filingId::record-notice', {
      params,
      headers,
      payload: Schema.Struct({
        noticeFileId: FileId,
        payableAmount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
        paymentDue: CalendarDate,
      }),
      success,
      error: commandErrors,
    }),
    HttpApiEndpoint.post('pay', '/:filingId::pay', {
      params,
      headers,
      payload: Schema.Struct({ paidOn: CalendarDate }),
      success,
      error: commandErrors,
    }),
    HttpApiEndpoint.post('close', '/:filingId::close', { params, headers, success, error: commandErrors }),
    HttpApiEndpoint.post('cancel', '/:filingId::cancel', {
      params,
      headers,
      payload: Schema.Struct({ reason: Reason }),
      success,
      error: commandErrors,
    }),
    HttpApiEndpoint.patch('answerRequirement', '/:filingId/requirements/:code', {
      params: requirementParams,
      payload: Schema.Struct({
        response: Schema.Literals(['PENDING', 'NOT_APPLICABLE']),
        note: Schema.optionalKey(Schema.NullOr(Schema.String)),
      }),
      success,
      error: requirementErrors,
    }),
    HttpApiEndpoint.post('attachRequirementFile', '/:filingId/requirements/:code/files', {
      params: requirementParams,
      payload: Schema.Struct({ fileId: FileId }),
      success,
      error: requirementErrors,
    }),
    HttpApiEndpoint.delete('detachRequirementFile', '/:filingId/requirements/:code/files/:fileId', {
      params: { ...requirementParams, fileId: FileId },
      success,
      error: requirementErrors,
    }),
    HttpApiEndpoint.post('addDocument', '/:filingId/documents', {
      params,
      payload: Schema.Struct({ type: Schema.Literals(['RETURN', 'PAYMENT_SLIP']), fileId: FileId }),
      success,
      error: [...accessErrors, FilingNotFound, FilingLocked, FilingActorNotAllowed],
    }),
    HttpApiEndpoint.get('getDocument', '/:filingId/documents/:documentId', {
      params: { filingId: FilingId, documentId: FilingDocumentId },
      success: FilingDocument,
      error: [...accessErrors, FilingNotFound, FilingDocumentNotFound],
    }),
  )
  .middleware(Authentication)
  .prefix('/filings') {}
