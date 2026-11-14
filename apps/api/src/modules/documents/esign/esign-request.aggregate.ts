import { Result } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { Violation } from '../../../shared/problem/problem.types.ts'
import type { DirectoryEmployee } from '../../hr/hr.public.ts'
import type { DocumentEvent } from '../shared/documents-ports.ts'
import { signedTermsOf } from '../signing/signed-terms.ts'
import {
  EsignLinkClosed,
  EsignVerificationFailed,
  EsignVerificationLocked,
  SignerSessionInvalid,
} from '../signing/signing-errors.ts'
import { decideVerification } from '../signing/signer-verification.ts'
import type { EsignTemplateRecord } from '../templates/esign-template.ts'
import { dueDateOnSend, isLinkClosed, isOverdue, transitionEsignRequest } from './esign-request-status.ts'
import type { EsignRequestEvent, EsignRequestStatus } from './esign-request-status.types.ts'
import {
  EsignRequestInvalid,
  EsignRequestTransitionInvalid,
  type EsignRequestDraft,
  type EsignRequestRecord,
} from './esign-request.ts'
import { validateEsignSend } from './esign-send-validation.ts'

/**
 * 전자서명 요청 애그리거트입니다(docs/design/domain-model.md). 관리자 커맨드(생성·수정·삭제·발송·초안으로·취소·무효), 시스템 커맨드(만료),
 * 서명자 커맨드(본인확인·완료)의 판정 함수(`decide…`)를 둡니다.
 *
 * 판정 함수는 순수 함수입니다. 템플릿·HR 직원·회사의 지우지 않은 도장은 서비스가 읽어 넘깁니다. 링크·세션 토큰은 서비스가 만들고 해시만
 * 넘깁니다. 메일 발송·본인확인·PDF 렌더링 같은 바깥 호출은 서비스가 하고 결과를 넘깁니다(M8). 바깥 호출이 있는 커맨드는 `plan…`으로
 * 먼저 받을 수 있는지 보고, 호출한 뒤 `decide…`로 다음 상태를 정합니다. 버전 검사(`If-Match`)는 서비스가 맡습니다.
 */

/** 판정 결과입니다. */
export interface EsignRequestDecision {
  request: EsignRequestRecord
  events: DocumentEvent[]
}

/**
 * 실패 응답과 함께 남기는 쓰기입니다(M1). `keep`이 있으면 서비스가 그것을 저장하고 `keepChanges`를 부른 뒤 `error`로 응답합니다.
 */
export interface EsignRequestRejection<E> {
  error: E
  keep?: { request: EsignRequestRecord }
}

/** 시각입니다. `today`는 회사 시간대의 날짜로, 기한 만료를 봅니다. */
export interface EsignClock {
  iso: string
  today: string
}

/** 저장한 요청에 기한 만료를 반영한 상태입니다. 만료는 기한 다음날부터입니다. */
export function effectiveStatus(record: EsignRequestRecord, today: string): EsignRequestStatus {
  return isOverdue(record.status, record.dueDate, today) ? 'EXPIRED' : record.status
}

/** 관리자 커맨드를 받을 수 있는지 봅니다. 기한이 지난 요청은 만료로 보고 판정합니다. */
function transition(
  record: EsignRequestRecord,
  today: string,
  command: EsignRequestEvent,
): Result.Result<EsignRequestStatus | 'DELETED', EsignRequestTransitionInvalid> {
  const currentStatus = effectiveStatus(record, today)
  const result = transitionEsignRequest(currentStatus, command)
  return result.ok
    ? Result.succeed(result.to)
    : Result.fail(new EsignRequestTransitionInvalid({ currentStatus, command }))
}

// ── 초안 ─────────────────────────────────────────────────────────────

/** 초안 판정에 필요한 사실입니다. */
export interface EsignDraftFacts {
  /** `templateIds` 순서대로 찾은 템플릿입니다. 없으면 `undefined`입니다. */
  templates: ReadonlyArray<EsignTemplateRecord | undefined>
  /** 수신자 직원입니다. `recipient.employeeId`가 없거나 찾지 못했으면 `undefined`입니다. */
  employee: DirectoryEmployee | undefined
  /** 회사의 지우지 않은 도장 ID입니다. 다른 회사 도장 ID는 없는 것과 같습니다. */
  activeSealIds: ReadonlySet<string>
}

type DraftContent = Pick<
  EsignRequestRecord,
  'title' | 'recipient' | 'templateIds' | 'fieldValues' | 'hiddenFields' | 'companySealId' | 'dueDate'
>

/** 초안 내용을 검사하고 수신자의 빈 값을 인사 정보로 채웁니다. 위반은 모두 모아 돌려줍니다. */
function draftContent(
  draft: typeof EsignRequestDraft.Type,
  facts: EsignDraftFacts,
): Result.Result<DraftContent, EsignRequestInvalid> {
  const violations: Violation[] = []
  facts.templates.forEach((template, index) => {
    if (template === undefined || template.kind.endsWith('_CERTIFICATE')) {
      violations.push({ field: `templateIds[${index}]`, code: 'NOT_FOUND' })
    }
  })
  const { employeeId } = draft.recipient
  const { employee } = facts
  if (employeeId !== undefined && employee === undefined) {
    violations.push({ field: 'recipient.employeeId', code: 'NOT_FOUND' })
  }
  if (draft.companySealId !== undefined && !facts.activeSealIds.has(draft.companySealId)) {
    violations.push({ field: 'companySealId', code: 'NOT_FOUND' })
  }
  const name = draft.recipient.name ?? employee?.name
  if (name === undefined || name.trim() === '') violations.push({ field: 'recipient.name', code: 'REQUIRED' })
  if (violations.length > 0 || name === undefined) return Result.fail(new EsignRequestInvalid({ violations }))
  return Result.succeed({
    title: draft.title,
    recipient: {
      employeeId,
      name,
      email: draft.recipient.email ?? employee?.email,
      phone: draft.recipient.phone ?? employee?.phone,
      isForeigner: draft.recipient.isForeigner ?? employee?.isForeigner ?? false,
      nationalityCode: draft.recipient.nationalityCode ?? employee?.nationalityCode,
      visaCode: draft.recipient.visaCode ?? employee?.visaCode,
    },
    templateIds: draft.templateIds,
    fieldValues: draft.fieldValues ?? {},
    hiddenFields: draft.hiddenFields ?? {},
    companySealId: draft.companySealId,
    dueDate: draft.dueDate,
  })
}

/** 만들 요청의 ID와 회사입니다. ID는 서비스가 정합니다. */
export interface EsignRequestCreation {
  id: Id<'esignRequest'>
  companyId: Id<'company'>
}

/** 생성을 판정합니다. 초안(`DRAFT`)으로 만듭니다. */
export function decideEsignRequestCreation(
  input: EsignRequestCreation,
  draft: typeof EsignRequestDraft.Type,
  facts: EsignDraftFacts,
  now: EsignClock,
): Result.Result<EsignRequestDecision, EsignRequestInvalid> {
  return Result.map(draftContent(draft, facts), (content) => ({
    request: {
      id: input.id,
      companyId: input.companyId,
      status: 'DRAFT',
      ...content,
      verifyFailures: 0,
      sessions: [],
      version: 1,
      createdAt: now.iso,
      updatedAt: now.iso,
    },
    events: [],
  }))
}

/** 수정을 판정합니다. 초안일 때만 받고, 상태를 먼저 본 뒤 내용을 검사합니다. */
export function decideEsignRequestUpdate(
  record: EsignRequestRecord,
  draft: typeof EsignRequestDraft.Type,
  facts: EsignDraftFacts,
  now: EsignClock,
): Result.Result<EsignRequestDecision, EsignRequestTransitionInvalid | EsignRequestInvalid> {
  return transition(record, now.today, 'UPDATE').pipe(
    Result.flatMap(() => draftContent(draft, facts)),
    Result.map((content) => ({
      request: { ...record, ...content, version: record.version + 1, updatedAt: now.iso },
      events: [],
    })),
  )
}

/** 삭제를 판정합니다. 발송 전 초안과 취소·만료·발송 실패만 지울 수 있습니다. */
export function decideEsignRequestRemoval(
  record: EsignRequestRecord,
  today: string,
): Result.Result<void, EsignRequestTransitionInvalid> {
  return Result.map(transition(record, today, 'DELETE'), () => undefined)
}

// ── 발송 ─────────────────────────────────────────────────────────────

/** 발송 검증에 필요한 사실입니다. */
export interface EsignSendFacts {
  templates: ReadonlyArray<EsignTemplateRecord | undefined>
  /** 수신자 직원입니다. 필드 기본값(`employee.name`·`employee.joinDate`)을 채웁니다. */
  employee: DirectoryEmployee | undefined
  activeSealIds: ReadonlySet<string>
}

/** 보낼 수 있는 요청에 찍을 도장입니다. */
export interface EsignSendPlan {
  companySealId: Id<'companySeal'> | undefined
}

/**
 * 발송·재발송을 받을 수 있는지 봅니다(현행 R22). 상태를 먼저 보고, 발송 검증 위반과 도장(템플릿 기본 도장이나 그새 지운 도장도)을
 * 모아 거부합니다. 서비스는 이것이 통과해야 링크를 만들어 메일을 보냅니다.
 */
export function planEsignRequestSend(
  record: EsignRequestRecord,
  command: 'SEND' | 'RESEND',
  facts: EsignSendFacts,
  today: string,
): Result.Result<EsignSendPlan, EsignRequestTransitionInvalid | EsignRequestInvalid> {
  return Result.flatMap(transition(record, today, command), () => {
    const { employee } = facts
    const sourceValues: Record<string, unknown> =
      employee === undefined ? {} : { 'employee.name': employee.name, 'employee.joinDate': employee.joinDate }
    const check = validateEsignSend({
      recipient: record.recipient,
      documents: facts.templates.map((template, index) => ({
        index,
        templateActive: template?.isActive ?? false,
        fields: template?.fields ?? [],
        defaultCompanySealId: template?.defaultCompanySealId,
      })),
      fieldValues: record.fieldValues,
      hiddenFields: record.hiddenFields,
      sourceValues,
      companySealId: record.companySealId,
    })
    if (check.companySealId !== undefined && !facts.activeSealIds.has(check.companySealId)) {
      check.violations.push({ field: 'companySealId', code: 'NOT_FOUND' })
    }
    if (check.violations.length > 0) return Result.fail(new EsignRequestInvalid({ violations: check.violations }))
    return Result.succeed({ companySealId: check.companySealId as Id<'companySeal'> | undefined })
  })
}

/** 메일 발송 결과입니다. */
export interface EsignDelivery {
  delivered: boolean
  /** 이번에 만든 링크 토큰의 해시입니다. */
  linkTokenHash: string
}

/**
 * 발송을 판정합니다. 보냈으면 `PENDING`과 `esign_request.sent`, 못 보냈으면 `SEND_FAILED`입니다. 어느 쪽이든 새 링크로 바꾸고
 * 본인확인 실패 횟수와 세션을 비웁니다. 기한은 지정한 날이 오늘 이후면 그대로, 아니면 오늘 + 16일입니다.
 */
export function decideEsignRequestSend(
  record: EsignRequestRecord,
  plan: EsignSendPlan,
  delivery: EsignDelivery,
  now: EsignClock,
): EsignRequestDecision {
  const request: EsignRequestRecord = {
    ...record,
    status: delivery.delivered ? 'PENDING' : 'SEND_FAILED',
    companySealId: plan.companySealId,
    dueDate: dueDateOnSend(
      record.dueDate !== undefined && record.dueDate >= now.today ? record.dueDate : undefined,
      now.today,
    ),
    sentAt: now.iso,
    linkTokenHash: delivery.linkTokenHash,
    verifyFailures: 0,
    sessions: [],
    version: record.version + 1,
    updatedAt: now.iso,
  }
  return {
    request,
    events: delivery.delivered
      ? [{ type: 'esign_request.sent', companyId: record.companyId, requestId: record.id, at: now.iso }]
      : [],
  }
}

// ── 초안으로·취소·무효·만료 ──────────────────────────────────────────

/**
 * 초안으로 되돌리기·취소·무효를 판정합니다. 링크를 닫고(무효는 완료본 다운로드를 위해 링크를 남김) 세션을 비웁니다. 초안으로 되돌리면
 * 기한과 발송 시각을 지웁니다. 무효는 `esign_request.voided`를 냅니다.
 */
export function decideEsignRequestCommand(
  record: EsignRequestRecord,
  command: 'REVERT_TO_DRAFT' | 'CANCEL' | 'VOID',
  now: EsignClock,
): Result.Result<EsignRequestDecision, EsignRequestTransitionInvalid> {
  return Result.flatMap(transition(record, now.today, command), (status) => {
    if (status === 'DELETED') {
      return Result.fail(new EsignRequestTransitionInvalid({ currentStatus: record.status, command }))
    }
    return Result.succeed({
      request: {
        ...record,
        status,
        ...(command === 'REVERT_TO_DRAFT' ? { dueDate: undefined, sentAt: undefined } : {}),
        linkTokenHash: command === 'VOID' ? record.linkTokenHash : undefined,
        sessions: [],
        version: record.version + 1,
        updatedAt: now.iso,
      },
      events:
        command === 'VOID'
          ? [{ type: 'esign_request.voided', companyId: record.companyId, requestId: record.id, at: now.iso }]
          : [],
    })
  })
}

/**
 * 기한이 지난 서명 대기·진행 중 요청을 만료합니다(시스템 커맨드). 바꿀 것이 없으면 `null`입니다.
 *
 * 링크 토큰과 서명 세션을 지워 링크를 닫습니다. 다시 보내면(`:resend`) 새 링크가 나갑니다.
 */
export function decideExpire(record: EsignRequestRecord, today: string, at: string): EsignRequestDecision | null {
  if (!isOverdue(record.status, record.dueDate, today)) return null
  const result = transitionEsignRequest(record.status, 'EXPIRE')
  if (!result.ok || result.to === 'DELETED') return null
  return {
    request: {
      ...record,
      status: result.to,
      linkTokenHash: undefined,
      sessions: [],
      version: record.version + 1,
      updatedAt: at,
    },
    events: [{ type: 'esign_request.expired', companyId: record.companyId, requestId: record.id, at }],
  }
}

// ── 서명자 ───────────────────────────────────────────────────────────

/** 서명자 링크가 열려 있는지 봅니다. 초안·취소·무효·만료·발송 실패·완료면 `EsignLinkClosed`입니다. */
export function signerLinkStatus(
  record: EsignRequestRecord,
  today: string,
): Result.Result<EsignRequestStatus, EsignLinkClosed> {
  const status = effectiveStatus(record, today)
  return isLinkClosed(status) || status === 'COMPLETED'
    ? Result.fail(new EsignLinkClosed({ currentStatus: status }))
    : Result.succeed(status)
}

/** 본인확인 결과와 맞으면 열 세션입니다. */
export interface SignerVerificationAttempt {
  /** 이름·생년월일이 맞는지입니다. 본인확인 포트의 결과입니다. */
  matches: boolean
  /** 맞으면 열 세션입니다. 토큰은 서비스가 만들고 해시만 넘깁니다. */
  session: { tokenHash: string; expiresAt: string }
}

/**
 * 본인확인을 판정합니다. 이미 다섯 번 틀렸으면 잠금(`EsignVerificationLocked`)이고, 틀리면 실패 횟수를 남기며 거부합니다(M1, 거부의
 * `keep`). 맞으면 `IN_PROGRESS`로 옮기고 실패 횟수를 비우며, 만료된 세션을 걷어 내고 새 세션을 더합니다.
 */
export function decideSignerVerification(
  record: EsignRequestRecord,
  attempt: SignerVerificationAttempt,
  now: EsignClock,
): Result.Result<
  { request: EsignRequestRecord },
  EsignRequestRejection<EsignLinkClosed | EsignVerificationFailed | EsignVerificationLocked>
> {
  const open = signerLinkStatus(record, now.today)
  if (Result.isFailure(open)) return Result.fail({ error: open.failure })
  const status = open.success
  const decision = decideVerification({ failures: record.verifyFailures, matches: attempt.matches })
  if (decision.outcome === 'LOCKED') return Result.fail({ error: new EsignVerificationLocked({}) })
  if (decision.outcome === 'FAILED') {
    return Result.fail({
      error: new EsignVerificationFailed({ remainingAttempts: decision.remainingAttempts }),
      keep: { request: { ...record, verifyFailures: decision.failures } },
    })
  }
  const moved = transitionEsignRequest(status, 'VERIFY_SIGNER')
  return Result.succeed({
    request: {
      ...record,
      status: moved.ok && moved.to !== 'DELETED' ? moved.to : status,
      verifyFailures: 0,
      sessions: [...record.sessions.filter((session) => session.expiresAt > now.iso), attempt.session],
      version: record.version + 1,
      updatedAt: now.iso,
    },
  })
}

/** 서명자가 채운 값입니다. 문서 번호별 필드 값입니다. */
export type SignerValues = Readonly<Record<string, Readonly<Record<string, unknown>>>>

/** 완료할 수 있는 요청에 남길 필드 값입니다. 렌더링에 씁니다. */
export interface SigningCompletionPlan {
  status: EsignRequestStatus
  fieldValues: Record<string, Readonly<Record<string, unknown>>>
}

/**
 * 서명 완료를 받을 수 있는지 보고 남길 필드 값을 정합니다. 링크가 열려 있고 세션이 살아 있어야 합니다. 서명자는 템플릿이 서명자에게
 * 맡긴 필드(`signer: true`)만 채우고, 관리자가 정한 계약 조건은 덮어쓰지 못합니다. 서비스는 이 값으로 PDF를 만듭니다.
 */
export function planSigningCompletion(
  record: EsignRequestRecord,
  sessionTokenHash: string | undefined,
  signerValues: SignerValues,
  templates: ReadonlyArray<EsignTemplateRecord | undefined>,
  now: EsignClock,
): Result.Result<SigningCompletionPlan, EsignLinkClosed | SignerSessionInvalid> {
  const open = signerLinkStatus(record, now.today)
  if (Result.isFailure(open)) return Result.fail(open.failure)
  const status = open.success
  {
    const live =
      sessionTokenHash !== undefined &&
      record.sessions.some((session) => session.tokenHash === sessionTokenHash && session.expiresAt > now.iso)
    if (!live) return Result.fail(new SignerSessionInvalid({}))
    const moved = transitionEsignRequest(status, 'COMPLETE')
    if (!moved.ok || moved.to === 'DELETED') return Result.fail(new EsignLinkClosed({ currentStatus: status }))
    const fieldValues: Record<string, Readonly<Record<string, unknown>>> = { ...record.fieldValues }
    for (const [index, values] of Object.entries(signerValues)) {
      const template = templates[Number(index)]
      if (template === undefined) continue
      const signerKeys = new Set(template.fields.filter((field) => field.signer).map((field) => field.key))
      const allowed = Object.fromEntries(Object.entries(values).filter(([key]) => signerKeys.has(key)))
      fieldValues[index] = { ...fieldValues[index], ...allowed }
    }
    return Result.succeed({ status: moved.to, fieldValues })
  }
}

/**
 * 서명 완료를 판정합니다. 렌더링한 완료본 파일을 받아 `COMPLETED`로 옮기고 세션을 비우며 `esign_request.completed`를 냅니다. 이벤트의
 * 문서별 계약 조건(`terms`)은 관리자가 정한 값(서명자 입력 전)에서 읽습니다.
 */
export function decideSigningCompletion(
  record: EsignRequestRecord,
  plan: SigningCompletionPlan,
  templates: ReadonlyArray<EsignTemplateRecord | undefined>,
  resultFileId: Id<'file'>,
  now: EsignClock,
): EsignRequestDecision {
  return {
    request: {
      ...record,
      status: plan.status,
      fieldValues: plan.fieldValues,
      completedAt: now.iso,
      resultFileId,
      sessions: [],
      version: record.version + 1,
      updatedAt: now.iso,
    },
    events: [
      {
        type: 'esign_request.completed',
        companyId: record.companyId,
        requestId: record.id,
        ...(record.recipient.employeeId === undefined ? {} : { employeeId: record.recipient.employeeId }),
        title: record.title,
        documents: templates.flatMap((template, index) =>
          template === undefined
            ? []
            : [
                {
                  index,
                  kind: template.kind,
                  title: template.title,
                  terms: signedTermsOf(template.kind, record.fieldValues[String(index)] ?? {}),
                },
              ],
        ),
        resultFileId,
        at: now.iso,
      },
    ],
  }
}
