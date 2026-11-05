import { createHash, randomBytes } from 'node:crypto'
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
}

/** 메모리 세션 저장소입니다. */
export function memorySessionStore(): SessionStore {
  const sessions = new Map<string, BffSession>()
  return {
    get: async (id) => sessions.get(id),
    save: async (session) => void sessions.set(session.id, session),
    delete: async (id) => void sessions.delete(id),
  }
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

  shared<A>(sessionId: string, task: () => Promise<A>): Promise<A> {
    return this.#lock(sessionId).shared(task)
  }

  exclusive<A>(sessionId: string, task: () => Promise<A>): Promise<A> {
    return this.#lock(sessionId).exclusive(task)
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

/** 쓰기가 기다리는 동안 새 읽기는 쓰기 뒤로 줄을 섭니다. 쓰기가 굶지 않습니다. */
class ReadWriteLock {
  #readers = 0
  /** 앞선 쓰기를 기다리는 읽기입니다. 자물쇠를 맵에서 지워도 되는지 셀 때만 씁니다. */
  #waiting = 0
  #writers = 0
  #writerTail: Promise<void> = Promise.resolve()
  #drained: Array<() => void> = []
  readonly #onIdle: () => void

  constructor(onIdle: () => void) {
    this.#onIdle = onIdle
  }

  async shared<A>(task: () => Promise<A>): Promise<A> {
    let tail: Promise<void>
    this.#waiting += 1
    do {
      tail = this.#writerTail
      await tail
    } while (tail !== this.#writerTail)
    this.#waiting -= 1
    this.#readers += 1
    try {
      return await task()
    } finally {
      this.#readers -= 1
      if (this.#readers === 0) for (const resolve of this.#drained.splice(0)) resolve()
      this.#releaseIfIdle()
    }
  }

  exclusive<A>(task: () => Promise<A>): Promise<A> {
    this.#writers += 1
    const run = async (): Promise<A> => {
      while (this.#readers > 0) await new Promise<void>((resolve) => this.#drained.push(resolve))
      return task()
    }
    const result = this.#writerTail.then(run)
    this.#writerTail = result.then(
      () => undefined,
      () => undefined,
    )
    void this.#writerTail.then(() => {
      this.#writers -= 1
      this.#releaseIfIdle()
    })
    return result
  }

  #releaseIfIdle(): void {
    if (this.#readers === 0 && this.#waiting === 0 && this.#writers === 0) this.#onIdle()
  }
}
