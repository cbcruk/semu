/** Social login providers the client offers. */
export type SocialProvider = 'kakao'

/** Profile returned by the provider after the code exchange. */
export interface SocialProfile {
  providerUid: string
  email: string | null
  name: string | null
}

/** OAuth authorization-code exchange with a social login provider. */
export interface SocialLoginAdapter {
  /** Exchanges an authorization code for the user's profile, or `null` when the code is invalid. */
  exchangeCode(provider: SocialProvider, code: string): Promise<SocialProfile | null>
}
