/** 비밀번호 정책 위반 사유입니다. 422 `PASSWORD_POLICY_VIOLATED`의 `violations[].code`로 나갑니다. */
export type PasswordViolation =
  'PASSWORD_LENGTH' | 'PASSWORD_LETTER_REQUIRED' | 'PASSWORD_DIGIT_REQUIRED' | 'PASSWORD_WHITESPACE'
