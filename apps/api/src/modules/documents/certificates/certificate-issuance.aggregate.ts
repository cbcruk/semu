import { Result } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { Violation } from '../../../shared/problem/problem.types.ts'
import type { DirectoryEmployee } from '../../hr/hr.public.ts'
import type { DocumentEvent } from '../shared/documents-ports.ts'
import type { EsignTemplateRecord } from '../templates/esign-template.ts'
import {
  CertificateInvalid,
  CertificateTransitionInvalid,
  type CertificateIssuanceRecord,
} from './certificate-issuance.ts'
import { nextIssueNumber, transitionCertificate } from './certificate-rules.ts'

/**
 * 제증명 발급 애그리거트입니다(docs/design/domain-model.md). 발급·발송·무효의 판정 함수(`decide…`)를 둡니다.
 *
 * 판정 함수는 순수 함수입니다. 템플릿과 HR 직원, 회사의 발급번호 목록은 서비스가 읽어 넘깁니다(발급번호가 해마다 겹치지 않음은
 * 회사 범위 불변식, M3). 메일 발송은 서비스가 하고 그 결과를 넘깁니다(M8). 버전 검사(`If-Match`)는 서비스가 맡습니다.
 */

/** 판정 결과입니다. */
export interface CertificateIssuanceDecision {
  issuance: CertificateIssuanceRecord
  events: DocumentEvent[]
}

/** 발급할 증명서입니다. ID와 시각은 서비스가 정합니다. */
export interface CertificateIssuanceInput {
  id: Id<'certificateIssuance'>
  companyId: Id<'company'>
  templateId: Id<'esignTemplate'>
  employeeId: Id<'employee'>
  purpose?: string | undefined
  recipientEmail?: string | undefined
  issuedAt: string
  /** 발급 연도(회사 시간대)입니다. */
  year: number
}

/** 발급 판정에 필요한 사실입니다. */
export interface CertificateIssuanceFacts {
  template: EsignTemplateRecord | undefined
  employee: DirectoryEmployee | undefined
  /** 회사가 쓴 발급번호 전체입니다. 무효인 증명서의 번호도 셉니다. */
  issuedNumbers: ReadonlyArray<string>
}

/**
 * 발급을 판정합니다. 켜진 증명서 템플릿과 직원이 있어야 하고, 퇴직증명서는 퇴직일이 있어야 합니다. 받는 사람 이메일이 없으면
 * 직원 이메일입니다. 발급번호는 그해 가장 큰 연번 + 1입니다.
 */
export function decideCertificateIssuance(
  input: CertificateIssuanceInput,
  facts: CertificateIssuanceFacts,
): Result.Result<CertificateIssuanceDecision, CertificateInvalid> {
  const { template, employee } = facts
  const violations: Violation[] = []
  if (template === undefined || !template.kind.endsWith('_CERTIFICATE') || !template.isActive) {
    violations.push({ field: 'templateId', code: 'NOT_FOUND' })
  }
  if (employee === undefined) violations.push({ field: 'employeeId', code: 'NOT_FOUND' })
  if (template?.kind === 'RETIREMENT_CERTIFICATE' && employee !== undefined && employee.leaveDate === undefined) {
    violations.push({ field: 'employeeId', code: 'LEAVE_DATE_REQUIRED' })
  }
  if (violations.length > 0) return Result.fail(new CertificateInvalid({ violations }))
  const issuance: CertificateIssuanceRecord = {
    id: input.id,
    companyId: input.companyId,
    templateId: input.templateId,
    employeeId: input.employeeId,
    issueNumber: nextIssueNumber(facts.issuedNumbers, input.year),
    status: 'ISSUED',
    purpose: input.purpose,
    recipientEmail: input.recipientEmail ?? employee?.email,
    issuedAt: input.issuedAt,
    version: 1,
  }
  return Result.succeed({
    issuance,
    events: [{ type: 'certificate.issued', companyId: input.companyId, issuanceId: issuance.id, at: input.issuedAt }],
  })
}

/**
 * 발송할 수 있는지 봅니다. 서비스는 이것으로 메일을 보낼지 정하고, 보낸 결과로 {@link decideCertificateSend}를 부릅니다.
 * 상태가 발송을 받지 않으면 `CertificateTransitionInvalid`, 받는 사람 이메일이 없으면 `CertificateInvalid`입니다.
 */
export function planCertificateSend(
  issuance: CertificateIssuanceRecord,
): Result.Result<{ recipientEmail: string }, CertificateTransitionInvalid | CertificateInvalid> {
  if (transitionCertificate(issuance.status, 'SEND') === undefined) {
    return Result.fail(new CertificateTransitionInvalid({ currentStatus: issuance.status }))
  }
  if (issuance.recipientEmail === undefined) {
    return Result.fail(new CertificateInvalid({ violations: [{ field: 'recipientEmail', code: 'REQUIRED' }] }))
  }
  return Result.succeed({ recipientEmail: issuance.recipientEmail })
}

/** 메일 발송 결과입니다. */
export interface CertificateDelivery {
  delivered: boolean
  sentAt: string
  /** 링크 만료 시각(발송 시각 + 30일)입니다. */
  linkExpiresAt: string
}

/** 발송을 판정합니다. 보냈으면 `SENT`, 못 보냈으면 `SEND_FAILED`이고 어느 쪽이든 발송 시각과 링크 만료를 남깁니다. */
export function decideCertificateSend(
  issuance: CertificateIssuanceRecord,
  delivery: CertificateDelivery,
): Result.Result<{ issuance: CertificateIssuanceRecord }, CertificateTransitionInvalid | CertificateInvalid> {
  return Result.map(planCertificateSend(issuance), () => ({
    issuance: {
      ...issuance,
      status: transitionCertificate('SENDING', delivery.delivered ? 'DELIVERED' : 'DELIVERY_FAILED') ?? 'SEND_FAILED',
      sentAt: delivery.sentAt,
      linkExpiresAt: delivery.linkExpiresAt,
      version: issuance.version + 1,
    },
  }))
}

/** 무효를 판정합니다. 지우지 않고 무효 시각을 남깁니다. */
export function decideCertificateVoid(
  issuance: CertificateIssuanceRecord,
  at: string,
): Result.Result<{ issuance: CertificateIssuanceRecord }, CertificateTransitionInvalid> {
  const status = transitionCertificate(issuance.status, 'VOID')
  if (status === undefined) return Result.fail(new CertificateTransitionInvalid({ currentStatus: issuance.status }))
  return Result.succeed({ issuance: { ...issuance, status, voidedAt: at, version: issuance.version + 1 } })
}
