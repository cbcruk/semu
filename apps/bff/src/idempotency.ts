import { createHash, randomUUID } from 'node:crypto'

/**
 * 현행 클라이언트가 `Idempotency-Key` 없이 보내는 외부 효과 요청(명세서 발송)에 BFF가 붙이는 키입니다.
 *
 * 같은 요청(같은 지문)이 `windowMs` 안에 다시 오면 같은 키를 다시 써서, 새 API가 처음 응답을 그대로 돌려주게(재응답) 합니다.
 * 두 번 누르기·네트워크 재시도·시간 초과 뒤 재시도가 메일을 두 번 보내지 않게 하려는 것입니다.
 *
 * - 같은 지문의 요청은 한 번에 하나씩 갑니다. 새 API는 키를 처리 **뒤에** 기억하므로, 동시에 두 요청이 같은 키로 가면 둘 다
 *   보낼 수 있어서입니다. 뒤 요청은 앞 요청이 끝난 뒤 같은 키로 가서 재응답을 받습니다
 * - 창은 앞 요청이 **끝난** 때부터 셉니다. 창이 지나면 새 키라 같은 명세서를 다시 보낼 수 있습니다
 * - 지문은 SHA-256만 둡니다. 세션·회사·대상 ID 원문은 메모리에도 남기지 않습니다
 * - 프로세스 메모리라 BFF 인스턴스가 하나일 때만 맞습니다(세션 저장소와 같은 한계)
 */
export class IdempotencyKeys {
  private readonly keys = new Map<string, { key: string; expiresAt: number }>()
  private readonly queues = new Map<string, Promise<unknown>>()

  constructor(
    private readonly windowMs: number,
    private readonly now: () => number,
  ) {}

  /** 지문을 만듭니다. 같은 요청이 같은 순서로 부분을 넘기는 것은 호출하는 쪽의 몫입니다. */
  static fingerprint(parts: readonly string[]): string {
    return createHash('sha256').update(JSON.stringify(parts)).digest('hex')
  }

  /**
   * 지문에 묶인 키로 `send`를 부릅니다. 같은 지문의 앞 요청이 진행 중이면 끝날 때까지 기다립니다.
   *
   * @param prefix 새로 만드는 키의 앞부분입니다. 새 API 로그에서 BFF가 만든 키를 알아보게 합니다.
   */
  async run<A>(fingerprint: string, prefix: string, send: (key: string) => Promise<A>): Promise<A> {
    const previous = this.queues.get(fingerprint) ?? Promise.resolve()
    const current = previous
      .catch(() => undefined)
      .then(async () => {
        this.prune()
        const key = this.keys.get(fingerprint)?.key ?? `${prefix}:${randomUUID()}`
        try {
          return await send(key)
        } finally {
          this.keys.set(fingerprint, { key, expiresAt: this.now() + this.windowMs })
        }
      })
    this.queues.set(fingerprint, current)
    try {
      return await current
    } finally {
      if (this.queues.get(fingerprint) === current) this.queues.delete(fingerprint)
    }
  }

  private prune(): void {
    const now = this.now()
    for (const [fingerprint, entry] of this.keys) {
      if (entry.expiresAt <= now) this.keys.delete(fingerprint)
    }
  }
}
