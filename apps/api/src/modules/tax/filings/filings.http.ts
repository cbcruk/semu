import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { cannotFail, expectedVersion, withEtag } from '../../../shared/http/versioning.ts'
import { authorize } from '../../identity-access/authorization.ts'
import type { AccessRequirement } from '../../identity-access/authorization.ts'
import type { Permission } from '../../identity-access/actor.types.ts'
import type { FilingCommandInput } from './filings.ts'
import { Filings } from './filings.ts'

/** 신고 건은 세무 기장 고객의 기능이고, 약관 재동의가 끝나야 씁니다. */
const access = (permission: Permission): AccessRequirement => ({ permission, plans: ['TAXATION'], requiresTerms: true })

/** 커맨드별 권한입니다. 대리인 커맨드는 `filing:process` 하나로 묶습니다. */
const COMMAND_PERMISSION: Record<FilingCommandInput['command'], Permission> = {
  REQUEST: 'filing:process',
  SUBMIT: 'filing:submit',
  UNSUBMIT: 'filing:submit',
  START_REVIEW: 'filing:process',
  REJECT: 'filing:process',
  UPLOAD_LEDGER: 'filing:process',
  CONFIRM_LEDGER: 'filing:confirm-ledger',
  DISPUTE_LEDGER: 'filing:confirm-ledger',
  START_PREPARING: 'filing:process',
  FILE: 'filing:process',
  RECORD_NOTICE: 'filing:process',
  PAY: 'filing:pay',
  CLOSE: 'filing:process',
  CANCEL: 'filing:process',
}

/** 신고 건 조회·커맨드·제출 자료·문서 핸들러입니다. */
export const FilingsHttpLive = HttpApiBuilder.group(
  Api,
  'filings',
  Effect.fn(function* (handlers) {
    const filings = yield* Filings
    const noPendingCheck = cannotFail('FilingRequirementsPending')

    const command = (
      filingId: Parameters<typeof filings.apply>[1],
      input: FilingCommandInput,
      ifMatch: string | undefined,
    ) =>
      authorize(access(COMMAND_PERMISSION[input.command])).pipe(
        Effect.flatMap((actor) => filings.apply(actor, filingId, input, expectedVersion(ifMatch))),
      )

    return handlers.handleAll({
      list: ({ query }) =>
        authorize(access('filing:read')).pipe(
          Effect.flatMap((actor) => {
            const { open, ...rest } = query
            return filings.list(actor, { ...rest, ...(open === undefined ? {} : { open: open === 'true' }) })
          }),
        ),
      get: ({ params }) =>
        authorize(access('filing:read')).pipe(
          Effect.flatMap((actor) => filings.get(actor, params.filingId)),
          Effect.map(withEtag),
        ),
      history: ({ params }) =>
        authorize(access('filing:read')).pipe(
          Effect.flatMap((actor) => filings.history(actor, params.filingId)),
          Effect.map((items) => ({ items })),
        ),
      request: ({ params, headers, payload }) =>
        command(params.filingId, { command: 'REQUEST', ...payload }, headers['if-match']).pipe(
          noPendingCheck,
          Effect.map(withEtag),
        ),
      submit: ({ params, headers }) =>
        command(params.filingId, { command: 'SUBMIT' }, headers['if-match']).pipe(Effect.map(withEtag)),
      unsubmit: ({ params, headers }) =>
        command(params.filingId, { command: 'UNSUBMIT' }, headers['if-match']).pipe(
          noPendingCheck,
          Effect.map(withEtag),
        ),
      startReview: ({ params, headers }) =>
        command(params.filingId, { command: 'START_REVIEW' }, headers['if-match']).pipe(
          noPendingCheck,
          Effect.map(withEtag),
        ),
      reject: ({ params, headers, payload }) =>
        command(params.filingId, { command: 'REJECT', ...payload }, headers['if-match']).pipe(
          noPendingCheck,
          Effect.map(withEtag),
        ),
      uploadLedger: ({ params, headers, payload }) =>
        command(params.filingId, { command: 'UPLOAD_LEDGER', ...payload }, headers['if-match']).pipe(
          noPendingCheck,
          Effect.map(withEtag),
        ),
      confirmLedger: ({ params, headers }) =>
        command(params.filingId, { command: 'CONFIRM_LEDGER' }, headers['if-match']).pipe(
          noPendingCheck,
          Effect.map(withEtag),
        ),
      disputeLedger: ({ params, headers, payload }) =>
        command(params.filingId, { command: 'DISPUTE_LEDGER', ...payload }, headers['if-match']).pipe(
          noPendingCheck,
          Effect.map(withEtag),
        ),
      startPreparing: ({ params, headers }) =>
        command(params.filingId, { command: 'START_PREPARING' }, headers['if-match']).pipe(
          noPendingCheck,
          Effect.map(withEtag),
        ),
      file: ({ params, headers, payload }) =>
        command(params.filingId, { command: 'FILE', ...payload }, headers['if-match']).pipe(
          noPendingCheck,
          Effect.map(withEtag),
        ),
      recordNotice: ({ params, headers, payload }) =>
        command(params.filingId, { command: 'RECORD_NOTICE', ...payload }, headers['if-match']).pipe(
          noPendingCheck,
          Effect.map(withEtag),
        ),
      pay: ({ params, headers, payload }) =>
        command(params.filingId, { command: 'PAY', ...payload }, headers['if-match']).pipe(
          noPendingCheck,
          Effect.map(withEtag),
        ),
      close: ({ params, headers }) =>
        command(params.filingId, { command: 'CLOSE' }, headers['if-match']).pipe(noPendingCheck, Effect.map(withEtag)),
      cancel: ({ params, headers, payload }) =>
        command(params.filingId, { command: 'CANCEL', ...payload }, headers['if-match']).pipe(
          noPendingCheck,
          Effect.map(withEtag),
        ),
      answerRequirement: ({ params, payload }) =>
        authorize(access('filing:update')).pipe(
          Effect.flatMap((actor) => filings.answerRequirement(actor, params.filingId, params.code, payload)),
          Effect.map(withEtag),
        ),
      attachRequirementFile: ({ params, payload }) =>
        authorize(access('filing:update')).pipe(
          Effect.flatMap((actor) => filings.attachRequirementFile(actor, params.filingId, params.code, payload.fileId)),
          Effect.map(withEtag),
        ),
      detachRequirementFile: ({ params }) =>
        authorize(access('filing:update')).pipe(
          Effect.flatMap((actor) => filings.detachRequirementFile(actor, params.filingId, params.code, params.fileId)),
          Effect.map(withEtag),
        ),
      addDocument: ({ params, payload }) =>
        authorize(access('filing:process')).pipe(
          Effect.flatMap((actor) => filings.addDocument(actor, params.filingId, payload)),
          Effect.map(withEtag),
        ),
      getDocument: ({ params }) =>
        authorize(access('filing:read')).pipe(
          Effect.flatMap((actor) => filings.viewDocument(actor, params.filingId, params.documentId)),
        ),
    })
  }),
)
