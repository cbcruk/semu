/** 본인확인 시도 하나의 판정입니다. `failures`는 저장할 새 실패 횟수입니다. */
export type SignerVerificationOutcome =
  | { outcome: 'VERIFIED'; failures: 0 }
  | { outcome: 'FAILED'; failures: number; remainingAttempts: number }
  | { outcome: 'LOCKED'; failures: number }
