import { Result } from 'effect'
import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { FilingObligation } from '../calendar/filing-calendar.types.ts'
import { filingRecord } from '../tax-demo.ts'
import {
  decideDeadlineRefresh,
  decideDocumentAdd,
  decideDocumentView,
  decideFilingCommand,
  decidePayrollLedgerRelink,
  decideRequirementAnswer,
  decideRequirementFileAttach,
  decideRequirementFileDetach,
  decideScheduleCancel,
  decideScheduleRestore,
} from './filing.aggregate.ts'
import type { FilingDecisionContext } from './filing.aggregate.ts'
import type { FilingDocumentId, FilingRecord } from './filing.types.ts'

const AT = '2026-11-14T01:00:00.000Z'
const USER = 'usr_01JBQ0000000000000000000U1' as Id<'user'>
const FILE = 'fle_01JBQ0000000000000000000F1' as Id<'file'>
const CLIENT: FilingDecisionContext = { at: AT, actor: { kind: 'CLIENT', userId: USER } }
const AGENCY: FilingDecisionContext = { at: AT, actor: { kind: 'AGENCY', userId: USER } }

function vat(overrides: Partial<FilingRecord> = {}): FilingRecord {
  return filingRecord({
    id: 'fil_01JBQ000000000000000000V01' as Id<'filing'>,
    taxType: 'VAT',
    kind: 'FINAL',
    periodKey: '2026-H2',
    periodStart: '2026-07-01',
    periodEnd: '2026-12-31',
    status: 'REQUESTED',
    ...overrides,
  })
}

function withholding(overrides: Partial<FilingRecord> = {}): FilingRecord {
  return filingRecord({
    id: 'fil_01JBQ000000000000000000W01' as Id<'filing'>,
    taxType: 'WITHHOLDING_TAX',
    kind: 'MONTHLY',
    periodKey: '2026-10',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    status: 'REQUESTED',
    ...overrides,
  })
}

/** 모든 항목에 답한 신고 건입니다. */
function answered(filing: FilingRecord): FilingRecord {
  return {
    ...filing,
    requirements: filing.requirements.map((requirement) => ({ ...requirement, response: 'NOT_APPLICABLE' })),
  }
}

const obligation: FilingObligation = {
  taxType: 'WITHHOLDING_TAX',
  kind: 'MONTHLY',
  periodKey: '2026-10',
  periodStart: '2026-10-01',
  periodEnd: '2026-10-31',
  statutoryDue: '2026-11-10',
  dueDate: '2026-11-10',
  paymentDue: '2026-11-10',
} as FilingObligation

function success<A, E>(result: Result.Result<A, E>): A {
  if (Result.isFailure(result)) throw new Error(`거부됨: ${JSON.stringify(result.failure)}`)
  return result.success
}

function failure<A, E>(result: Result.Result<A, E>): E {
  if (Result.isSuccess(result)) throw new Error('거부되어야 합니다')
  return result.failure
}

describe('상태 커맨드(decideFilingCommand)', () => {
  it('답하지 않은 항목이 있으면 제출을 거부하고 남은 항목을 알려 줍니다', () => {
    // given 자료를 요청받은 부가세 신고 건
    const filing = vat()
    // when 고객이 제출하면
    const rejection = failure(decideFilingCommand(filing, { command: 'SUBMIT' }, CLIENT))
    // then 남은 항목 코드와 함께 거부됩니다
    expect(rejection._tag).toBe('FilingRequirementsPending')
    expect(rejection).toMatchObject({ requirementCodes: filing.requirements.map((requirement) => requirement.code) })
  })

  it('다른 행위자의 커맨드는 거부합니다', () => {
    const rejection = failure(
      decideFilingCommand(vat({ status: 'SCHEDULED' }), { command: 'REQUEST', submitDue: '2026-12-01' }, CLIENT),
    )
    expect(rejection).toMatchObject({ _tag: 'FilingActorNotAllowed', requiredActorKind: 'AGENCY' })
  })

  it('전이표에 없는 상태에서는 거부합니다', () => {
    const rejection = failure(
      decideFilingCommand(vat({ status: 'FILED' }), { command: 'CANCEL', reason: '중복' }, AGENCY),
    )
    expect(rejection).toMatchObject({ _tag: 'FilingTransitionInvalid', currentStatus: 'FILED', command: 'CANCEL' })
  })

  it('상태를 바꾸고 이력 한 줄을 남기며 버전을 올리고 filing.status_changed를 냅니다', () => {
    const filing = answered(vat())
    const decision = success(decideFilingCommand(filing, { command: 'SUBMIT' }, CLIENT))
    expect(decision.filing).toMatchObject({ status: 'SUBMITTED', version: filing.version + 1, updatedAt: AT })
    expect(decision.filing.history.at(-1)).toMatchObject({
      type: 'SUBMIT',
      actorKind: 'CLIENT',
      actorId: USER,
      fromStatus: 'REQUESTED',
      toStatus: 'SUBMITTED',
      occurredAt: AT,
    })
    expect(decision.events).toEqual([
      expect.objectContaining({ type: 'filing.status_changed', fromStatus: 'REQUESTED', toStatus: 'SUBMITTED' }),
    ])
  })

  it('원천세 제출을 대리인이 대행하면 고객 대신 한 일로 남깁니다', () => {
    const decision = success(decideFilingCommand(answered(withholding()), { command: 'SUBMIT' }, AGENCY))
    expect(decision.filing.history.at(-1)).toMatchObject({ actorKind: 'AGENCY', onBehalfOf: 'CLIENT' })
  })

  it('상태가 그대로인 커맨드(매입매출장 다시 올리기)는 이벤트를 내지 않습니다', () => {
    const decision = success(
      decideFilingCommand(vat({ status: 'LEDGER_PENDING' }), { command: 'UPLOAD_LEDGER', ledgerFileId: FILE }, AGENCY),
    )
    expect(decision.filing.status).toBe('LEDGER_PENDING')
    expect(decision.filing.ledgerUploadedAt).toBe(AT)
    expect(decision.events).toEqual([])
  })

  it('신고하면 세액과 신고서를 남기고, 납부 기한이 없으면 신고 기한을 씁니다', () => {
    const decision = success(
      decideFilingCommand(
        vat({ status: 'PREPARING', dueDate: '2027-01-25' }),
        { command: 'FILE', payableAmount: 120_000, returnFileId: FILE },
        AGENCY,
      ),
    )
    expect(decision.filing).toMatchObject({ payableAmount: 120_000, paymentDue: '2027-01-25', paymentSlipSentAt: null })
    expect(decision.filing.documents).toEqual([expect.objectContaining({ type: 'RETURN', fileId: FILE })])
  })
})

describe('제출 자료(decideRequirement…)', () => {
  it('파일이 붙은 항목은 해당 없음으로 답할 수 없습니다', () => {
    const filing = success(decideRequirementFileAttach(vat(), 'SIMPLE_RECEIPT', FILE, CLIENT)).filing
    const rejection = failure(decideRequirementAnswer(filing, 'SIMPLE_RECEIPT', { response: 'NOT_APPLICABLE' }, CLIENT))
    expect(rejection._tag).toBe('RequirementHasFiles')
  })

  it('파일을 붙이면 PROVIDED, 마지막 파일을 떼면 PENDING입니다', () => {
    const attached = success(decideRequirementFileAttach(vat(), 'SIMPLE_RECEIPT', FILE, CLIENT)).filing
    expect(attached.requirements.find((requirement) => requirement.code === 'SIMPLE_RECEIPT')).toMatchObject({
      response: 'PROVIDED',
      fileIds: [FILE],
      updatedBy: USER,
    })
    const detached = success(decideRequirementFileDetach(attached, 'SIMPLE_RECEIPT', FILE, CLIENT)).filing
    expect(detached.requirements.find((requirement) => requirement.code === 'SIMPLE_RECEIPT')).toMatchObject({
      response: 'PENDING',
      fileIds: [],
    })
    expect(detached.version).toBe(attached.version + 1)
  })

  it('붙지 않은 파일은 뗄 수 없습니다', () => {
    const rejection = failure(decideRequirementFileDetach(vat(), 'SIMPLE_RECEIPT', FILE, CLIENT))
    expect(rejection._tag).toBe('RequirementFileNotFound')
  })

  it('자료 요청 상태가 아니면 고칠 수 없습니다', () => {
    const rejection = failure(
      decideRequirementAnswer(vat({ status: 'SUBMITTED' }), 'SIMPLE_RECEIPT', { response: 'PENDING' }, CLIENT),
    )
    expect(rejection).toMatchObject({ _tag: 'FilingLocked', currentStatus: 'SUBMITTED' })
  })

  it('자동 연계 항목은 고칠 수 없습니다', () => {
    const rejection = failure(
      decideRequirementAnswer(withholding(), 'PAYROLL_LEDGER_CLOSED', { response: 'NOT_APPLICABLE' }, CLIENT),
    )
    expect(rejection._tag).toBe('RequirementAutoLinked')
  })

  it('대리인이 고치면 고객 대신 한 일로 남깁니다', () => {
    const decision = success(
      decideRequirementAnswer(vat(), 'SIMPLE_RECEIPT', { response: 'NOT_APPLICABLE', note: '없음' }, AGENCY),
    )
    expect(decision.filing.history.at(-1)).toMatchObject({
      type: 'REQUIREMENT_ANSWERED',
      onBehalfOf: 'CLIENT',
      detail: { code: 'SIMPLE_RECEIPT', response: 'NOT_APPLICABLE' },
    })
  })
})

describe('문서(decideDocumentAdd·decideDocumentView)', () => {
  it('고객은 문서를 붙일 수 없습니다', () => {
    const rejection = failure(decideDocumentAdd(vat({ status: 'PREPARING' }), { type: 'RETURN', fileId: FILE }, CLIENT))
    expect(rejection).toMatchObject({ _tag: 'FilingActorNotAllowed', requiredActorKind: 'AGENCY' })
  })

  it('신고 뒤 납부서를 붙이면 납부서 보낸 시각을 남깁니다', () => {
    const decision = success(
      decideDocumentAdd(vat({ status: 'FILED' }), { type: 'PAYMENT_SLIP', fileId: FILE }, AGENCY),
    )
    expect(decision.filing.paymentSlipSentAt).toBe(AT)
  })

  it('고객이 처음 열면 열람 시각을 남기고, 버전은 그대로입니다', () => {
    const filed = success(decideDocumentAdd(vat({ status: 'FILED' }), { type: 'RETURN', fileId: FILE }, AGENCY)).filing
    const documentId = filed.documents[0]!.id
    const decision = success(decideDocumentView(filed, documentId, CLIENT))
    expect(decision.document.firstViewedAt).toBe(AT)
    expect(decision.filing?.version).toBe(filed.version)
    // 다시 열면 남길 것이 없습니다
    expect(success(decideDocumentView(decision.filing!, documentId, CLIENT)).filing).toBeNull()
  })

  it('대리인이 열면 열람 시각을 남기지 않습니다', () => {
    const filed = success(decideDocumentAdd(vat({ status: 'FILED' }), { type: 'RETURN', fileId: FILE }, AGENCY)).filing
    expect(success(decideDocumentView(filed, filed.documents[0]!.id, AGENCY)).filing).toBeNull()
  })

  it('없는 문서는 찾을 수 없습니다', () => {
    const rejection = failure(decideDocumentView(vat(), 'fdc_01JBQ0000000000000000000X1' as FilingDocumentId, AGENCY))
    expect(rejection._tag).toBe('FilingDocumentNotFound')
  })
})

describe('시스템 커맨드', () => {
  it('급여대장이 모두 마감되면 자동 연계 항목을 PROVIDED로 맞추고 버전을 올립니다', () => {
    const filing = withholding()
    const decision = decidePayrollLedgerRelink(filing, { ledgerCount: 2, closedCount: 2 }, AT, {
      paymentMonth: '2026-10',
    })
    expect(decision?.filing.version).toBe(filing.version + 1)
    expect(decision?.filing.history.at(-1)).toMatchObject({
      type: 'REQUIREMENT_LINKED',
      actorKind: 'SYSTEM',
      detail: { code: 'PAYROLL_LEDGER_CLOSED', response: 'PROVIDED', paymentMonth: '2026-10' },
    })
  })

  it('맞출 것이 없으면 null입니다', () => {
    expect(decidePayrollLedgerRelink(withholding(), { ledgerCount: 0, closedCount: 0 }, AT, {})).toBeNull()
  })

  it('기한을 고치면 이력을 남기고 이벤트는 없습니다', () => {
    const decision = decideDeadlineRefresh(withholding({ status: 'SCHEDULED' }), obligation, AT)
    expect(decision.filing).toMatchObject({ dueDate: '2026-11-10', paymentDue: '2026-11-10' })
    expect(decision.filing.history.at(-1)?.type).toBe('DEADLINES_REFRESHED')
    expect(decision.events).toEqual([])
  })

  it('배치가 취소하면 filing.status_changed를 냅니다', () => {
    const decision = decideScheduleCancel(withholding({ status: 'SCHEDULED' }), AT)
    expect(decision.filing.status).toBe('CANCELED')
    expect(decision.events).toEqual([expect.objectContaining({ fromStatus: 'SCHEDULED', toStatus: 'CANCELED' })])
  })

  it('되살리면 지금 마감 현황으로 자동 연계 항목을 맞추고 버전은 한 번만 올립니다', () => {
    const canceled = withholding({ status: 'CANCELED', version: 3 })
    const decision = decideScheduleRestore(canceled, obligation, { ledgerCount: 1, closedCount: 1 }, AT)
    expect(decision.filing).toMatchObject({ status: 'SCHEDULED', version: 4 })
    expect(decision.filing.history.map((entry) => entry.type)).toEqual(['SCHEDULE_RESTORED', 'REQUIREMENT_LINKED'])
    expect(decision.events).toEqual([expect.objectContaining({ fromStatus: 'CANCELED', toStatus: 'SCHEDULED' })])
  })
})
