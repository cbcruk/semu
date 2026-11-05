import { describeRuleFixture } from '../shared/rule-fixture.test-support.ts'
import { nextIssueNumber, transitionCertificate } from './certificate-rules.ts'
import type { CertificateCommand, CertificateStatus } from './certificate-rules.types.ts'

type Input =
  | { check: 'issueNumber'; issued: string[]; year: number }
  | { check: 'transition'; from: CertificateStatus; command: CertificateCommand }

/** 결정 1(바꿈): 지우지 않고 무효로 남기며, 발송 중에는 무효로 할 수 없습니다. */
const CHANGED = {
  'remove while sending': 'CERTIFICATE_TRANSITION_INVALID',
}

describeRuleFixture(
  'certificate-issuance',
  (input: Input) =>
    input.check === 'issueNumber'
      ? nextIssueNumber(input.issued, input.year)
      : (transitionCertificate(input.from, input.command) ?? 'CERTIFICATE_TRANSITION_INVALID'),
  CHANGED,
)
