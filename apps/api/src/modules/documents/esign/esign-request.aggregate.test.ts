import { Result } from 'effect'
import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { DirectoryEmployee } from '../../hr/hr.public.ts'
import { BASE_TEMPLATES } from '../templates/esign-template.ts'
import {
  decideEsignRequestCommand,
  decideEsignRequestCreation,
  decideEsignRequestSend,
  decideEsignRequestUpdate,
  decideSignerVerification,
  decideSigningCompletion,
  planEsignRequestSend,
  planSigningCompletion,
} from './esign-request.aggregate.ts'
import type { EsignRequestRecord } from './esign-request.ts'

const COMPANY = 'cmp_01JBQ00000000000000000000A' as Id<'company'>
const SEAL = 'sel_01JBQ000000000000000000001'
const contract = BASE_TEMPLATES.find((template) => template.kind === 'EMPLOYMENT_CONTRACT')!
const certificate = BASE_TEMPLATES.find((template) => template.kind === 'EMPLOYMENT_CERTIFICATE')!
const now = { iso: '2026-11-14T00:00:00.000Z', today: '2026-11-14' }

const employee: DirectoryEmployee = {
  id: 'emp_01JBQ000000000000000000001' as Id<'employee'>,
  kind: 'WAGE',
  name: '홍길동',
  status: 'JOINED',
  joinDate: '2026-03-02',
  email: 'hong@example.com',
  isForeigner: false,
}

const facts = { templates: [contract], employee, activeSealIds: new Set([SEAL]) }

const draft = {
  title: '2026 근로계약',
  recipient: { employeeId: employee.id },
  templateIds: [contract.id],
  fieldValues: { '0': { workPlace: '본사', jobDescription: '회계' } },
  companySealId: SEAL as Id<'companySeal'>,
}

const created = () =>
  Result.getOrThrow(
    decideEsignRequestCreation(
      { id: 'esr_01JBQ000000000000000000001' as Id<'esignRequest'>, companyId: COMPANY },
      draft,
      facts,
      now,
    ),
  ).request

function pending(overrides: Partial<EsignRequestRecord> = {}): EsignRequestRecord {
  return {
    ...created(),
    status: 'PENDING',
    dueDate: '2026-11-30',
    sentAt: now.iso,
    linkTokenHash: 'link',
    sessions: [{ tokenHash: 'session', expiresAt: '2026-11-14T00:30:00.000Z' }],
    version: 2,
    ...overrides,
  }
}

describe('초안', () => {
  it('수신자의 빈 값을 인사 정보로 채워 초안으로 만듭니다', () => {
    const request = created()

    expect(request).toMatchObject({
      status: 'DRAFT',
      recipient: { employeeId: employee.id, name: '홍길동', email: 'hong@example.com', isForeigner: false },
      hiddenFields: {},
      version: 1,
    })
  })

  it('증명서 템플릿, 없는 직원, 다른 회사나 지운 도장, 빈 이름을 모두 알려 줍니다', () => {
    const result = decideEsignRequestCreation(
      { id: 'esr_01JBQ000000000000000000002' as Id<'esignRequest'>, companyId: COMPANY },
      { ...draft, templateIds: [certificate.id] },
      { templates: [certificate], employee: undefined, activeSealIds: new Set() },
      now,
    )

    expect(Result.isFailure(result) && result.failure.violations).toEqual([
      { field: 'templateIds[0]', code: 'NOT_FOUND' },
      { field: 'recipient.employeeId', code: 'NOT_FOUND' },
      { field: 'companySealId', code: 'NOT_FOUND' },
      { field: 'recipient.name', code: 'REQUIRED' },
    ])
  })

  it('보낸 요청은 내용이 틀려도 상태를 먼저 보고 수정을 거부합니다', () => {
    const result = decideEsignRequestUpdate(pending(), draft, { ...facts, templates: [undefined] }, now)

    expect(Result.isFailure(result) && result.failure._tag).toBe('EsignRequestTransitionInvalid')
  })
})

describe('발송', () => {
  it('찍을 도장이 지워졌으면 메일을 보내기 전에 거부합니다', () => {
    const result = planEsignRequestSend(created(), 'SEND', { ...facts, activeSealIds: new Set() }, now.today)

    expect(Result.isFailure(result) && result.failure).toMatchObject({
      _tag: 'EsignRequestInvalid',
      violations: [{ field: 'companySealId', code: 'NOT_FOUND' }],
    })
  })

  it('보냈으면 서명 대기와 발송 이벤트, 못 보냈으면 발송 실패이고 둘 다 새 링크와 기본 기한을 둡니다', () => {
    const record = { ...created(), verifyFailures: 3 }
    const plan = Result.getOrThrow(planEsignRequestSend(record, 'SEND', facts, now.today))
    const sent = decideEsignRequestSend(record, plan, { delivered: true, linkTokenHash: 'new' }, now)
    const failed = decideEsignRequestSend(record, plan, { delivered: false, linkTokenHash: 'new' }, now)

    expect(sent.request).toMatchObject({
      status: 'PENDING',
      companySealId: SEAL,
      dueDate: '2026-11-30',
      linkTokenHash: 'new',
      verifyFailures: 0,
      version: 2,
    })
    expect(sent.events).toEqual([{ type: 'esign_request.sent', companyId: COMPANY, requestId: record.id, at: now.iso }])
    expect(failed.request.status).toBe('SEND_FAILED')
    expect(failed.events).toEqual([])
  })
})

describe('초안으로·무효', () => {
  it('무효는 완료본 다운로드를 위해 링크를 남기고 무효 이벤트를 냅니다', () => {
    const decision = Result.getOrThrow(decideEsignRequestCommand(pending({ status: 'COMPLETED' }), 'VOID', now))

    expect(decision.request).toMatchObject({ status: 'VOIDED', linkTokenHash: 'link', sessions: [] })
    expect(decision.events.map((event) => event.type)).toEqual(['esign_request.voided'])
  })

  it('초안으로 되돌리면 링크·기한·발송 시각을 지웁니다', () => {
    const decision = Result.getOrThrow(
      decideEsignRequestCommand(pending({ status: 'CANCELED' }), 'REVERT_TO_DRAFT', now),
    )

    expect(decision.request).toMatchObject({
      status: 'DRAFT',
      linkTokenHash: undefined,
      dueDate: undefined,
      sentAt: undefined,
    })
    expect(decision.events).toEqual([])
  })
})

describe('decideSignerVerification', () => {
  const session = { tokenHash: 'next', expiresAt: '2026-11-14T00:30:00.000Z' }
  const later = { iso: '2026-11-14T00:40:00.000Z', today: '2026-11-14' }

  it('틀리면 실패 횟수를 남기라는 거부를 돌려줍니다(버전은 그대로)', () => {
    const result = decideSignerVerification(pending({ verifyFailures: 3 }), { matches: false, session }, now)

    expect(Result.isFailure(result) && result.failure.error).toMatchObject({
      _tag: 'EsignVerificationFailed',
      remainingAttempts: 1,
    })
    expect(Result.isFailure(result) && result.failure.keep?.request).toMatchObject({ verifyFailures: 4, version: 2 })
  })

  it('다섯 번 틀린 링크는 맞는 값이 와도 잠금이고 남길 것이 없습니다', () => {
    const result = decideSignerVerification(pending({ verifyFailures: 5 }), { matches: true, session }, now)

    expect(Result.isFailure(result) && result.failure).toEqual({
      error: expect.objectContaining({ _tag: 'EsignVerificationLocked' }),
    })
  })

  it('맞으면 서명 중으로 옮기고 만료된 세션을 걷어 낸 뒤 새 세션을 더합니다', () => {
    const decision = Result.getOrThrow(
      decideSignerVerification(pending({ verifyFailures: 2 }), { matches: true, session }, later),
    )

    expect(decision.request).toMatchObject({
      status: 'IN_PROGRESS',
      verifyFailures: 0,
      sessions: [session],
      version: 3,
    })
  })

  it('기한이 지난 링크는 만료로 닫혀 있습니다', () => {
    const result = decideSignerVerification(
      pending(),
      { matches: true, session },
      { iso: now.iso, today: '2026-12-01' },
    )

    expect(Result.isFailure(result) && result.failure.error).toMatchObject({
      _tag: 'EsignLinkClosed',
      currentStatus: 'EXPIRED',
    })
  })
})

describe('서명 완료', () => {
  const signerValues = { '0': { signerAddress: '서울', workPlace: '집' } }

  it('세션이 없거나 만료됐으면 거부합니다', () => {
    const missing = planSigningCompletion(pending(), undefined, signerValues, [contract], now)
    const expired = planSigningCompletion(pending(), 'session', signerValues, [contract], {
      iso: '2026-11-14T00:30:00.000Z',
      today: '2026-11-14',
    })

    expect(Result.isFailure(missing) && missing.failure._tag).toBe('SignerSessionInvalid')
    expect(Result.isFailure(expired) && expired.failure._tag).toBe('SignerSessionInvalid')
  })

  it('서명자는 서명자 필드만 채우고, 완료 이벤트의 계약 조건은 관리자 값에서 읽습니다', () => {
    const record = pending({ status: 'IN_PROGRESS' })
    const plan = Result.getOrThrow(planSigningCompletion(record, 'session', signerValues, [contract], now))
    const decision = decideSigningCompletion(
      record,
      plan,
      [contract],
      'fle_01JBQ000000000000000000009' as Id<'file'>,
      now,
    )

    expect(plan.fieldValues['0']).toEqual({ workPlace: '본사', jobDescription: '회계', signerAddress: '서울' })
    expect(decision.request).toMatchObject({ status: 'COMPLETED', sessions: [], completedAt: now.iso, version: 3 })
    expect(decision.events).toMatchObject([
      {
        type: 'esign_request.completed',
        employeeId: employee.id,
        resultFileId: 'fle_01JBQ000000000000000000009',
        documents: [{ index: 0, kind: 'EMPLOYMENT_CONTRACT' }],
      },
    ])
  })
})
