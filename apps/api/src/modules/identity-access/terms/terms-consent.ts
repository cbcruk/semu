import type { Plan } from '../actor.types.ts'
import type { ConsentHistory, ConsentStatus, ConsentTerm, TermPurpose } from './terms-consent.types.ts'

/**
 * 약관 하나의 동의 상태를 판정합니다.
 *
 * 현행 클라이언트 가드(B:104689-104696)를 옮겼습니다. 필수 약관은 동의 기록이 없거나, 거절했거나, 버전이 다르면
 * `REQUIRED`입니다. 선택 약관은 새 버전이 나오면 거절했던 사용자에게도 다시 묻습니다(`REVIEW`).
 *
 * @example
 * ```ts
 * consentStatus({ code: 'SERVICE', version: '2026-01', required: true }, { version: '2025-07', agreed: true }) // 'REQUIRED'
 * consentStatus({ code: 'MARKETING', version: '2026-01', required: false }, { version: '2026-01', agreed: false }) // 'SETTLED'
 * ```
 */
export function consentStatus(term: ConsentTerm, history: ConsentHistory | undefined): ConsentStatus {
  if (term.required) {
    return history === undefined || !history.agreed || history.version !== term.version ? 'REQUIRED' : 'SETTLED'
  }
  return history?.version === term.version ? 'SETTLED' : 'REVIEW'
}

/**
 * 회사 행위자에게 적용되는 약관 용도입니다.
 *
 * 가입 약관은 모두에게, 세무 약관은 지금 회사가 세무 기장(`TAXATION`) 플랜일 때만 적용합니다.
 * 현행은 "소속 회사 중 하나라도 세무 기장이면"이었지만 토큰이 회사 하나에 묶이므로 지금 회사로 판정합니다.
 */
export function applicablePurposes(plans: ReadonlySet<Plan>): TermPurpose[] {
  return plans.has('TAXATION') ? ['SIGNUP', 'TAX'] : ['SIGNUP']
}

/** 동의가 필요한(`REQUIRED`) 약관 코드입니다. `Actor.pendingTermCodes`가 됩니다. */
export function pendingTermCodes(
  terms: ReadonlyArray<ConsentTerm>,
  histories: ReadonlyMap<string, ConsentHistory>,
): string[] {
  return terms.filter((약관) => consentStatus(약관, histories.get(약관.code)) === 'REQUIRED').map((약관) => 약관.code)
}
