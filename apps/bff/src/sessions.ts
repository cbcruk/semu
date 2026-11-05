import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Plan, UserProfile } from './upstream.types.ts'

/**
 * BFF가 현행 세션 쿠키 하나에 대응시켜 서버에 두는 상태입니다.
 *
 * 브라우저는 현행처럼 `sessionid`와 CSRF 쿠키만 갖고, 새 API의 refresh 쿠키와 access token은 BFF 밖으로 나가지 않습니다.
 * 새 API 세션은 한 번에 한 회사에 묶이므로, `companyId`가 지금 access token이 묶인 회사입니다.
 */
export interface BffSession {
  /** 저장 키입니다. 쿠키 값의 SHA-256이라 저장소가 새도 쿠키를 만들 수 없습니다. */
  id: string
  csrfToken: string
  /** 새 API의 `semu_refresh=...` 쿠키입니다. 회전할 때마다 바꿉니다. */
  refreshCookie: string
  /** 회사가 없는 사용자는 access token이 없습니다. */
  accessToken?: string
  /** 이 시각(ms)이 지나면 새 API를 부르기 전에 갱신합니다. */
  accessExpiresAt?: number
  companyId?: string
  /** 지금 회사의 플랜입니다. 현행 `tax_plan`, `has_payroll_plan`을 채웁니다. */
  plans: Plan[]
  user: UserProfile
  staySignedIn: boolean
  /** 현행 로그인 응답의 `expires_at`이고, 지나면 세션을 버립니다. */
  expiresAt: number
}

/** BFF 세션 저장소입니다. 지금은 프로세스 메모리 하나뿐이라 BFF 인스턴스도 하나입니다. */
export interface SessionStore {
  get(id: string): Promise<BffSession | undefined>
  save(session: BffSession): Promise<void>
  delete(id: string): Promise<void>
  /** `expiresAt`이 `now` 이전인 세션을 지웁니다. */
  sweep(now: number): Promise<void>
}

/** 메모리 세션 저장소입니다. */
export function memorySessionStore(): SessionStore {
  const sessions = new Map<string, BffSession>()
  return {
    get: async (id) => sessions.get(id),
    save: async (session) => void sessions.set(session.id, session),
    delete: async (id) => void sessions.delete(id),
    sweep: async (now) => {
      for (const [id, session] of sessions) if (session.expiresAt <= now) sessions.delete(id)
    },
  }
}

/** 두 비밀을 걸리는 시간으로 내용을 짐작할 수 없게 비교합니다. CSRF 토큰 확인에 씁니다. */
export function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

/** 추측할 수 없는 URL 안전 토큰입니다. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

/** 쿠키 값으로 저장 키를 만듭니다. */
export function sessionKey(cookieValue: string): string {
  return createHash('sha256').update(cookieValue).digest('hex')
}

/** 세션 수명입니다. 새 API refresh 쿠키와 같습니다(1일, 로그인 유지면 14일). */
export function sessionLifetimeMs(staySignedIn: boolean): number {
  return (staySignedIn ? 14 : 1) * 24 * 60 * 60 * 1000
}

/**
 * 세션별 읽기·쓰기 자물쇠입니다.
 *
 * 새 API 세션은 한 번에 한 회사에 묶이고, 토큰 갱신·회사 전환은 이전 access token을 폐기하며 refresh 쿠키를 회전시킵니다.
 * 그래서 갱신·전환(`exclusive`)은 한 번에 하나만, 그리고 그 세션의 진행 중인 API 호출(`shared`)이 끝난 뒤에 합니다.
 * 같은 회사에 대한 호출끼리는 함께 갑니다. 갱신이 겹치면 새 API의 refresh 재사용 탐지에 걸려 세션이 폐기되고,
 * 호출 도중 전환되면 그 호출이 401을 받기 때문입니다.
 */
export class SessionLocks {
  readonly #locks = new Map<string, ReadWriteLock>()
  /** 지금 비동기 흐름이 쥔 세션 자물쇠입니다. 같은 세션 자물쇠를 안에서 또 잡으면 교착되므로 막습니다. */
  readonly #held = new AsyncLocalStorage<ReadonlySet<string>>()

  shared<A>(sessionId: string, task: () => Promise<A>): Promise<A> {
    this.#assertNotHeld(sessionId)
    return this.#lock(sessionId).shared(this.#holding(sessionId, task))
  }

  exclusive<A>(sessionId: string, task: () => Promise<A>): Promise<A> {
    this.#assertNotHeld(sessionId)
    return this.#lock(sessionId).exclusive(this.#holding(sessionId, task))
  }

  /**
   * 같은 세션 자물쇠를 겹쳐 잡지 못하게 합니다. 쓰기 안의 읽기는 자기 쓰기가 끝나기를 기다리고,
   * 읽기 안의 쓰기는 자기 읽기가 끝나기를 기다려 둘 다 영원히 멈춥니다.
   *
   * @throws {Error} 이미 이 세션 자물쇠 안이면. 프로그래밍 오류라 500이 됩니다.
   */
  #assertNotHeld(sessionId: string): void {
    if (this.#held.getStore()?.has(sessionId) === true) {
      throw new Error(
        `Session lock for ${sessionId.slice(0, 8)}… is already held by this call; nesting would deadlock.`,
      )
    }
  }

  #holding<A>(sessionId: string, task: () => Promise<A>): () => Promise<A> {
    const held = new Set(this.#held.getStore())
    held.add(sessionId)
    return () => this.#held.run(held, task)
  }

  #lock(sessionId: string): ReadWriteLock {
    let lock = this.#locks.get(sessionId)
    if (lock === undefined) {
      lock = new ReadWriteLock(() => this.#locks.delete(sessionId))
      this.#locks.set(sessionId, lock)
    }
    return lock
  }
}

/**
 * 도착 순서대로 내주는 읽기·쓰기 자물쇠입니다.
 *
 * 요청은 한 줄로 섭니다. 줄 맨 앞이 쓰기면 진행 중인 읽기가 모두 끝난 뒤 혼자 들어가고, 맨 앞이 읽기면 그 뒤로
 * 이어진 읽기까지 함께 들어갑니다. 늦게 온 요청은 먼저 온 요청을 앞지르지 못하므로 읽기도 쓰기도 굶지 않습니다.
 */
class ReadWriteLock {
  #readers = 0
  #writing = false
  readonly #queue: Array<{ mode: 'read' | 'write'; grant: () => void }> = []
  readonly #onIdle: () => void

  constructor(onIdle: () => void) {
    this.#onIdle = onIdle
  }

  shared<A>(task: () => Promise<A>): Promise<A> {
    return this.#run('read', task)
  }

  exclusive<A>(task: () => Promise<A>): Promise<A> {
    return this.#run('write', task)
  }

  async #run<A>(mode: 'read' | 'write', task: () => Promise<A>): Promise<A> {
    await new Promise<void>((grant) => {
      this.#queue.push({ mode, grant })
      this.#dispatch()
    })
    try {
      return await task()
    } finally {
      if (mode === 'read') this.#readers -= 1
      else this.#writing = false
      this.#dispatch()
      if (this.#readers === 0 && !this.#writing && this.#queue.length === 0) this.#onIdle()
    }
  }

  /** 줄 맨 앞부터 들어갈 수 있는 요청을 들여보냅니다. 앞이 막히면 뒤도 기다립니다. */
  #dispatch(): void {
    while (this.#queue.length > 0 && !this.#writing) {
      const head = this.#queue[0]!
      if (head.mode === 'write') {
        if (this.#readers > 0) return
        this.#queue.shift()
        this.#writing = true
        head.grant()
        return
      }
      this.#queue.shift()
      this.#readers += 1
      head.grant()
    }
  }
}
