/** 회사가 둘 수 있는 도장·사인 수입니다(매뉴얼 "최대 5개"). */
export const MAX_COMPANY_SEALS = 5

/** 전자서명 알림톡 수신자 수입니다(매뉴얼 "3명까지"). */
export const MAX_NOTIFICATION_RECIPIENTS = 3

/** 도장을 하나 더 등록할 수 있는지입니다. 지운(소프트 삭제) 도장은 세지 않습니다. */
export function canAddCompanySeal(activeSealCount: number): boolean {
  return activeSealCount < MAX_COMPANY_SEALS
}

/**
 * 알림을 받을 사람입니다. 설정한 수신자가 있으면 그들이고, 없으면 대표자 연락처입니다. 대표자 연락처도 없으면 아무도 받지 않습니다.
 *
 * @returns 받을 사람 목록. 설정이 한도를 넘으면 `undefined`(저장 거절)입니다.
 */
export function notificationTargets<R extends { phone: string }>(
  configured: ReadonlyArray<R>,
  representative: R | undefined,
): ReadonlyArray<R> | undefined {
  if (configured.length > MAX_NOTIFICATION_RECIPIENTS) return undefined
  if (configured.length > 0) return configured
  return representative === undefined ? [] : [representative]
}
