import { Result } from 'effect'
import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { DirectoryEmployee } from '../../hr/hr.public.ts'
import { BASE_TEMPLATES } from '../templates/esign-template.ts'
import {
  decideCertificateIssuance,
  decideCertificateSend,
  decideCertificateVoid,
  planCertificateSend,
} from './certificate-issuance.aggregate.ts'

const employment = BASE_TEMPLATES.find((template) => template.kind === 'EMPLOYMENT_CERTIFICATE')!
const retirement = BASE_TEMPLATES.find((template) => template.kind === 'RETIREMENT_CERTIFICATE')!
const contract = BASE_TEMPLATES.find((template) => !template.kind.endsWith('_CERTIFICATE'))!

const employee: DirectoryEmployee = {
  id: 'emp_01JBQ000000000000000000001' as Id<'employee'>,
  kind: 'WAGE',
  name: '홍길동',
  status: 'JOINED',
  joinDate: '2024-03-02',
  email: 'hong@example.com',
  isForeigner: false,
}

const input = {
  id: 'cti_01JBQ000000000000000000001' as Id<'certificateIssuance'>,
  companyId: 'cmp_01JBQ000000000000000000001' as Id<'company'>,
  templateId: employment.id,
  employeeId: employee.id,
  issuedAt: '2026-11-14T00:00:00.000Z',
  year: 2026,
}

const issue = () =>
  Result.getOrThrow(
    decideCertificateIssuance(input, { template: employment, employee, issuedNumbers: ['2026-0002', '2025-0009'] }),
  )

describe('decideCertificateIssuance', () => {
  it('그해 가장 큰 연번 다음 번호로 발급하고 받는 사람이 없으면 직원 이메일로 채우며 발급 이벤트를 냅니다', () => {
    const decision = issue()

    expect(decision.issuance).toMatchObject({
      issueNumber: '2026-0003',
      status: 'ISSUED',
      recipientEmail: 'hong@example.com',
      version: 1,
    })
    expect(decision.events).toEqual([
      { type: 'certificate.issued', companyId: input.companyId, issuanceId: input.id, at: input.issuedAt },
    ])
  })

  it('증명서가 아닌 템플릿과 없는 직원을 함께 알려 줍니다', () => {
    const result = decideCertificateIssuance(input, { template: contract, employee: undefined, issuedNumbers: [] })

    expect(Result.isFailure(result) && result.failure.violations).toEqual([
      { field: 'templateId', code: 'NOT_FOUND' },
      { field: 'employeeId', code: 'NOT_FOUND' },
    ])
  })

  it('퇴직일이 없는 직원에게는 퇴직증명서를 발급하지 않습니다', () => {
    const result = decideCertificateIssuance(
      { ...input, templateId: retirement.id },
      { template: retirement, employee, issuedNumbers: [] },
    )

    expect(Result.isFailure(result) && result.failure.violations).toEqual([
      { field: 'employeeId', code: 'LEAVE_DATE_REQUIRED' },
    ])
  })
})

describe('발송', () => {
  const delivery = { sentAt: '2026-11-14T01:00:00.000Z', linkExpiresAt: '2026-12-14T01:00:00.000Z' }

  it('보냈으면 SENT, 못 보냈으면 SEND_FAILED이고 둘 다 발송 시각과 링크 만료를 남깁니다', () => {
    const { issuance } = issue()

    expect(Result.getOrThrow(decideCertificateSend(issuance, { ...delivery, delivered: true })).issuance).toMatchObject(
      { status: 'SENT', ...delivery, version: 2 },
    )
    expect(Result.getOrThrow(decideCertificateSend(issuance, { ...delivery, delivered: false })).issuance.status).toBe(
      'SEND_FAILED',
    )
  })

  it('받는 사람 이메일이 없으면 메일을 보내기 전에 거부합니다', () => {
    const result = planCertificateSend({ ...issue().issuance, recipientEmail: undefined })

    expect(Result.isFailure(result) && result.failure._tag).toBe('CertificateInvalid')
  })

  it('무효인 증명서는 상태를 먼저 보고 거부합니다', () => {
    const voided = Result.getOrThrow(decideCertificateVoid(issue().issuance, delivery.sentAt)).issuance
    const result = planCertificateSend({ ...voided, recipientEmail: undefined })

    expect(voided).toMatchObject({ status: 'VOIDED', voidedAt: delivery.sentAt, version: 2 })
    expect(Result.isFailure(result) && result.failure._tag).toBe('CertificateTransitionInvalid')
    expect(Result.isFailure(decideCertificateVoid(voided, delivery.sentAt))).toBe(true)
  })
})
