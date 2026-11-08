import { Schema } from 'effect'

/** 개인정보를 열람하는 사유입니다. 열람 기록에 남습니다. 한글은 퍼센트 인코딩(UTF-8)해서 보냅니다. */
export const AccessReasonHeaders = { 'x-access-reason': Schema.NonEmptyString }

/** 퍼센트 인코딩한 헤더 값을 풉니다. 풀 수 없으면 받은 그대로 씁니다. */
export function decodeHeaderText(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
