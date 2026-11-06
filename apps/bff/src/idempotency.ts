import { createHash, randomUUID } from 'node:crypto'

/** 기억하는 발송 키의 기본 최대 수입니다. 1분 창 안에 이보다 많은 서로 다른 발송은 드뭅니다. */
export const DEFAULT_MAX_IDEMPOTENCY_KEYS = 10_000

/**
 * 결과를 모르는 실패(시간 초과, 연결 실패, 5xx) 뒤에 키를 기억하는 기본 시간입니다. 새 API의 키 수명과 같은 24시간입니다.
 * 그 사이 재시도가 같은 키로 가야 새 API가 처음 발송을 재응답하거나 이어 보내고, 이미 받은 사람에게 다시 보내지 않습니다.
 */
export const DEFAULT_UNCERTAIN_KEY_MS = 24 * 60 * 60 * 1000

/**
 * 현행 클라이언트가 `Idempotency-Key` 없이 보내는 외부 효과 요청(명세서 발송)에 BFF가 붙이는 키입니다.
 *
 * 같은 요청(같은 지문)이 `windowMs` 안에 다시 오면 같은 키를 다시 써서, 새 API가 처음 응답을 그대로 돌려주게(재응답) 합니다.
 * 두 번 누르기·네트워크 재시도·시간 초과 뒤 재시도가 메일을 두 번 보내지 않게 하려는 것입니다.
 *
 * - 같은 지문의 요청은 한 번에 하나씩 갑니다. 새 API는 처리 중인 같은 키를 409 `IDEMPOTENCY_KEY_IN_PROGRESS`로 거절하므로, 두
 *   번 누르기가 겹쳐도 뒤 요청이 오류 대신 앞 요청이 끝난 뒤 같은 키로 가서 재응답을 받게 하려는 것입니다
 * - 창은 앞 요청이 **끝난** 때부터 셉니다. 창이 지나면 새 키라 같은 명세서를 다시 보낼 수 있습니다
 * - 아무것도 나가지 않은 결과(작업 전체 실패)는 기억하지 않아, 다시 누르면 실제로 다시 보냅니다
 * - 결과를 모르는 실패(시간 초과·5xx·처리 중 409)는 성공할 때까지, 길게는 새 API의 키 수명(24시간) 동안 같은 키를 씁니다
 * - 기억하는 키는 {@link DEFAULT_MAX_IDEMPOTENCY_KEYS}개까지이고 넘으면 오래된 것부터 버립니다
 * - 지문은 SHA-256만 둡니다. 세션·회사·대상 ID 원문은 메모리에도 남기지 않습니다
 * - 프로세스 메모리라 BFF 인스턴스가 하나일 때만 맞습니다(세션 저장소와 같은 한계)
 */
export class IdempotencyKeys {
  private readonly keys = new Map<string, { key: string; expiresAt: number }>()
  private readonly queues = new Map<string, Promise<unknown>>()

  /**
   * @param maxEntries 기억하는 키의 최대 수입니다. 넘으면 가장 오래 쓰지 않은 키부터 버립니다. 버린 지문은 다음 발송에서 새 키라
   *   재응답을 받지 못하지만, 창(1분) 안에 이만큼 서로 다른 발송이 몰릴 때만 일어납니다.
   */
  constructor(
    private readonly windowMs: number,
    private readonly now: () => number,
    private readonly maxEntries: number = DEFAULT_MAX_IDEMPOTENCY_KEYS,
    private readonly uncertainMs: number = DEFAULT_UNCERTAIN_KEY_MS,
  ) {}

  /** 지문을 만듭니다. 같은 요청이 같은 순서로 부분을 넘기는 것은 호출하는 쪽의 몫입니다. */
  static fingerprint(parts: readonly string[]): string {
    return createHash('sha256').update(JSON.stringify(parts)).digest('hex')
  }

  /** 기억하는 키 수입니다. */
  get size(): number {
    return this.keys.size
  }

  /**
   * 같은 지문의 작업을 한 번에 하나씩 부릅니다. 앞 작업이 실패해도 뒤 작업은 갑니다.
   * 새 API는 처리 중인 같은 키를 409로 거절하므로, 겹친 뒤 요청이 409 대신 앞 요청의 재응답을 받게 합니다.
   */
  async serial<A>(fingerprint: string, work: () => Promise<A>): Promise<A> {
    const previous = this.queues.get(fingerprint) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(work)
    this.queues.set(fingerprint, current)
    try {
      return await current
    } finally {
      if (this.queues.get(fingerprint) === current) this.queues.delete(fingerprint)
    }
  }

  /**
   * 지문에 묶인 키로 `send`를 부릅니다({@link serial}). 끝나면 키를 창만큼 기억합니다.
   *
   * @param prefix 새로 만드는 키의 앞부분입니다. 새 API 로그에서 BFF가 만든 키를 알아보게 합니다.
   * @param keep 결과를 보고 키를 기억할지입니다. 아무것도 나가지 않은 결과(작업 전체 실패)면 거짓을 돌려 다음 요청이 다시 보내게
   *   합니다. 예외는 언제나 기억합니다.
   * @param uncertain 예외가 결과를 모르는 실패(시간 초과·5xx·처리 중 409)인지입니다. 참이면 창 대신 `uncertainMs`(기본 24시간) 동안 기억합니다.
   *   거짓(분명한 거절)이면 아무것도 나가지 않았으므로 창만큼만 기억합니다.
   */
  run<A>(
    fingerprint: string,
    prefix: string,
    send: (key: string) => Promise<A>,
    keep: (result: A) => boolean = () => true,
    uncertain: (error: unknown) => boolean = () => true,
  ): Promise<A> {
    return this.serial(fingerprint, async () => {
      this.prune()
      const key = this.keys.get(fingerprint)?.key ?? `${prefix}:${randomUUID()}`
      let result: A
      try {
        result = await send(key)
      } catch (error) {
        this.remember(fingerprint, key, uncertain(error) ? this.uncertainMs : this.windowMs)
        throw error
      }
      if (keep(result)) this.remember(fingerprint, key, this.windowMs)
      else this.keys.delete(fingerprint)
      return result
    })
  }

  private remember(fingerprint: string, key: string, ttlMs: number): void {
    this.keys.delete(fingerprint)
    this.keys.set(fingerprint, { key, expiresAt: this.now() + ttlMs })
    for (const oldest of this.keys.keys()) {
      if (this.keys.size <= this.maxEntries) break
      this.keys.delete(oldest)
    }
  }

  private prune(): void {
    const now = this.now()
    for (const [fingerprint, entry] of this.keys) {
      if (entry.expiresAt <= now) this.keys.delete(fingerprint)
    }
  }
}
