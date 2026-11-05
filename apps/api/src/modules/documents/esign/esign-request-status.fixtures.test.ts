import { describeRuleFixture } from '../shared/rule-fixture.test-support.ts'
import { transitionEsignRequest } from './esign-request-status.ts'
import type { EsignRequestEvent, EsignRequestStatus } from './esign-request-status.types.ts'

/** 결정 1(바꿈): 취소·만료·발송 실패에서 바로 다시 보냅니다. */
const CHANGED = {
  'expired resend': 'PENDING',
  'send failed resend': 'PENDING',
}

describeRuleFixture(
  'esign-request-transitions',
  (input: { from: EsignRequestStatus; event: EsignRequestEvent }) => {
    const result = transitionEsignRequest(input.from, input.event)
    return result.ok ? result.to : result.code
  },
  CHANGED,
)
