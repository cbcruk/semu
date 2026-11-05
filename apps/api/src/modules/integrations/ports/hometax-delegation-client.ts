import { Context, Effect, Layer } from 'effect'

/** 홈택스 수임동의 요청입니다. 대표자의 홈택스 로그인 정보는 이 호출에만 쓰고 저장하지 않습니다. */
export interface DelegationConsent {
  businessNumber: string
  agencyName: string
  hometaxLoginId: string
  hometaxPassword: string
}

/** 홈택스가 동의를 받았는지입니다. */
export type DelegationOutcome = { ok: true } | { ok: false; code: string }

/** 세무대리인 수임동의를 홈택스에 제출하는 어댑터 포트입니다. */
export class HometaxDelegationClient extends Context.Service<
  HometaxDelegationClient,
  {
    consent(request: DelegationConsent): Effect.Effect<DelegationOutcome>
  }
>()('semu/integrations/HometaxDelegationClient') {
  /** 결정적인 가짜입니다. `wrong`으로 시작하는 비밀번호는 홈택스 로그인 실패로 거절합니다. */
  static readonly layerFake = Layer.succeed(
    HometaxDelegationClient,
    HometaxDelegationClient.of({
      consent: (request) =>
        Effect.succeed(
          request.hometaxPassword.startsWith('wrong') ? { ok: false, code: 'HOMETAX_LOGIN_FAILED' } : { ok: true },
        ),
    }),
  )
}
