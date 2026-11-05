import type { CertificateStatus } from '../certificates/certificate-eligibility.types.ts'
import type { AuthMethod } from '../institutions/institution.ts'

/** 마지막 수집 결과 중 재시도 판정에 쓰는 부분입니다. */
export interface LastScrapOutcome {
  status: 'SUCCEEDED' | 'FAILED'
  /** 수집 어댑터가 오류 코드를 분류해 정합니다. 비밀번호 오류·계정 잠김·폐업은 거짓입니다. */
  isRetryable: boolean
}

/** 재시도 판정의 입력입니다. 연동 하나 또는 항목 하나입니다. */
export interface RetryInput {
  authMethod: AuthMethod
  /** 인증서 연동일 때 그 인증서의 상태입니다. 인증서가 없어졌으면 `UNREGISTERED`입니다. */
  certificateStatus?: CertificateStatus
  lastScrap?: LastScrapOutcome
}

/**
 * 연동(또는 항목)을 다시 수집해도 되는지 판정합니다. 응답의 `allowedActions`에 `RETRY`를 넣을지 정합니다.
 *
 * 인증서 연동은 인증서가 `ACTIVE`가 아니면 거짓입니다. 그 밖에는 마지막 결과의 `isRetryable`이고, 결과가 없으면 참입니다.
 * 현행 클라이언트처럼 기관 종류마다 기본값을 달리하지 않습니다.
 */
export function isRetryable(input: RetryInput): boolean {
  if (input.authMethod === 'CERTIFICATE' && input.certificateStatus !== 'ACTIVE') return false
  return input.lastScrap === undefined || input.lastScrap.isRetryable
}

/** 항목 하나입니다. 비활성 항목은 수집하지 않으므로 재시도 대상이 아닙니다. */
export interface RetryItem {
  key: string
  isActive: boolean
  lastScrap?: LastScrapOutcome
}

/** 재시도할 수 있는 항목 키입니다. 연동 자체가 재시도 불가면 비어 있습니다. */
export function retryableItemKeys(input: Omit<RetryInput, 'lastScrap'>, items: ReadonlyArray<RetryItem>): string[] {
  return items
    .filter(
      (item) =>
        item.isActive &&
        isRetryable({ ...input, ...(item.lastScrap === undefined ? {} : { lastScrap: item.lastScrap }) }),
    )
    .map((item) => item.key)
}
