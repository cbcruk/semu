import type { CertificateCommand, CertificateStatus } from './certificate-rules.types.ts'

/** 증명서 링크가 발송 후 유효한 날 수입니다. */
export const CERTIFICATE_LINK_DAYS = 30

const TRANSITIONS: Record<CertificateStatus, Partial<Record<CertificateCommand, CertificateStatus>>> = {
  ISSUED: { SEND: 'SENDING', VOID: 'VOIDED' },
  SENDING: { DELIVERED: 'SENT', DELIVERY_FAILED: 'SEND_FAILED' },
  SENT: { SEND: 'SENDING', VOID: 'VOIDED' },
  SEND_FAILED: { SEND: 'SENDING', VOID: 'VOIDED' },
  VOIDED: {},
}

/**
 * 회사·연도별 다음 발급번호 `YYYY-NNNN`입니다.
 *
 * 그해 이미 쓴 번호 중 가장 큰 연번 + 1이고, 무효화한 증명서의 번호도 센다(다시 쓰지 않음). 네 자리를 넘으면 자릿수가 늘어납니다.
 *
 * @example
 * ```ts
 * nextIssueNumber(['2026-0001', '2026-0002', '2025-0007'], 2026) // '2026-0003'
 * ```
 */
export function nextIssueNumber(issued: ReadonlyArray<string>, year: number): string {
  const prefix = `${year}-`
  const max = issued
    .filter((number) => number.startsWith(prefix))
    .reduce((highest, number) => Math.max(highest, Number(number.slice(prefix.length)) || 0), 0)
  return `${year}-${String(max + 1).padStart(4, '0')}`
}

/** 증명서 상태에 커맨드를 적용합니다. 받을 수 없으면 `undefined`입니다. */
export function transitionCertificate(
  from: CertificateStatus,
  command: CertificateCommand,
): CertificateStatus | undefined {
  return TRANSITIONS[from][command]
}

/** 증명서 화면 버튼을 켜는 `allowedActions`입니다. */
export function allowedCertificateActions(status: CertificateStatus): Array<'SEND' | 'VOID'> {
  return (['SEND', 'VOID'] as const).filter((command) => TRANSITIONS[status][command] !== undefined)
}

/** 링크가 만료됐는지입니다. 만료 시각 이후(같은 시각 포함)면 만료입니다. */
export function isCertificateLinkExpired(linkExpiresAt: string | undefined, now: string): boolean {
  return linkExpiresAt !== undefined && Date.parse(linkExpiresAt) <= Date.parse(now)
}
