import { describe, expect, it } from 'vitest'
import { loadRuleCases } from '../rule-fixtures.ts'
import { passwordViolations } from './password-policy.ts'

/**
 * 서버 함수로 옮기지 않는 케이스입니다.
 *
 * - 비밀번호 확인 일치는 화면 검증입니다. 재설계 API는 `confirmPassword`를 받지 않습니다
 * - 데모 계정 변경 거절과 변경 후 세션 폐기는 `sessions.http.test.ts`·`me` 서비스가 확인합니다
 * - 비밀번호 재설정은 아직 구현하지 않았습니다 ([identity-access.md](../../../../../../docs/design/identity-access.md#구현-상태))
 */
const NOT_PORTED = new Set([
  'confirmation mismatch',
  'demo account cannot change the password',
  'change revokes every session and sends the client to /login',
  'reset request for an unknown email still answers 202',
  'reset request for a demo account sends nothing',
  'reset token within 30 minutes',
  'reset token at 30 minutes is expired',
  'reset token used twice',
  'unknown reset token',
])

describe('비밀번호 정책 규칙 픽스처', () => {
  for (const testCase of loadRuleCases('password-policy')) {
    it.skipIf(NOT_PORTED.has(testCase.name))(testCase.name, () => {
      const expected = (testCase.expected as { legacyServer: unknown }).legacyServer
      const violations = passwordViolations(testCase.input['password'] as string)
      expect(violations.length === 0 ? 'valid' : { code: 'VALIDATION_FAILED', field: 'password' }).toEqual(expected)
    })
  }
})
