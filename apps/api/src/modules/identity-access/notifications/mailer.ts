import { Context, Effect, Layer, Ref } from 'effect'

/** 인증·초대 메일 종류입니다. 본문 템플릿은 메일 발송 서비스가 가집니다. */
export type MailTemplate = 'INVITATION' | 'PASSWORD_RESET' | 'EMAIL_VERIFICATION'

/** 보낼 메일 한 통입니다. `token`은 링크에 넣는 1회용 비밀이고 저장소에는 해시만 남습니다. */
export interface OutgoingMail {
  to: string
  template: MailTemplate
  token: string
  data: Readonly<Record<string, string>>
}

/** 메일 발송 포트입니다. 실패는 재시도 큐가 맡으므로 호출하는 쪽은 결과를 기다리지 않습니다. */
export class Mailer extends Context.Service<
  Mailer,
  {
    send(mail: OutgoingMail): Effect.Effect<void>
    /** 보낸 메일입니다. 메모리 구현에서만 의미가 있고 테스트가 링크 토큰을 꺼낼 때 씁니다. */
    sent(): Effect.Effect<ReadonlyArray<OutgoingMail>>
  }
>()('semu/identity-access/Mailer') {
  /** 보낸 메일을 메모리에 쌓기만 합니다. */
  static readonly layerMemory = Layer.effect(
    Mailer,
    Effect.gen(function* () {
      const outbox = yield* Ref.make<ReadonlyArray<OutgoingMail>>([])
      return Mailer.of({
        send: (mail) => Ref.update(outbox, (mails) => [...mails, mail]),
        sent: () => Ref.get(outbox),
      })
    }),
  )
}
