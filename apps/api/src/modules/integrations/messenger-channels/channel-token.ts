/** 상담 채널 연결 토큰을 거절한 이유입니다. */
export type ChannelTokenRejection = 'INVALID' | 'USED' | 'EXPIRED'

/** 판정에 쓰는 저장된 토큰입니다. 시각은 epoch 밀리초입니다. */
export interface StoredChannelToken {
  usedAt?: number
  expiresAt: number
}

/**
 * 메신저 브리지가 발급한 연결 토큰을 쓸 수 있는지 판정합니다. 없음, 사용됨, 만료 순서로 봅니다.
 *
 * 만료 시각과 같은 순간은 만료입니다.
 */
export function checkChannelToken(
  token: StoredChannelToken | undefined,
  now: number,
): ChannelTokenRejection | undefined {
  if (token === undefined) return 'INVALID'
  if (token.usedAt !== undefined) return 'USED'
  if (now >= token.expiresAt) return 'EXPIRED'
  return undefined
}
