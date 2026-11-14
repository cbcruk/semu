/**
 * 정기 작업의 실행 시각(슬롯)을 계산하는 순수 규칙입니다. 시각은 회사 시간대(`Asia/Seoul`, UTC+9, 일광 절약 시간 없음)의 벽시계입니다.
 */

/** 회사 시간대와 UTC의 차이(ms)입니다. 한국은 1988년 뒤로 일광 절약 시간이 없어 고정값입니다. */
const COMPANY_OFFSET_MS = 9 * 60 * 60 * 1000

/** 회사 시간대의 `HH:MM`입니다. */
export type WallTime = `${number}:${number}`

/**
 * 정기 작업을 언제 돌릴지입니다.
 *
 * - `DAILY`: 매일 `at`
 * - `MONTHLY`: 매달 `day`일 `at`. 그 달에 그날이 없으면(31일 등) 말일입니다
 */
export type ScheduleSpec =
  | { readonly kind: 'DAILY'; readonly at: WallTime }
  | { readonly kind: 'MONTHLY'; readonly day: number; readonly at: WallTime }

/** 실행 시각 하나입니다. `key`는 회사 시간대의 `YYYY-MM-DDTHH:MM`이고, 같은 작업의 같은 슬롯은 한 번만 돕니다. */
export interface ScheduleSlot {
  readonly key: string
  /** 슬롯 시각(epoch ms)입니다. */
  readonly at: number
}

/**
 * `now`(epoch ms) 이전의 가장 늦은 슬롯입니다(`now`와 같으면 그 슬롯). 실행기는 이 슬롯이 끝났는지만 봅니다. 프로세스가 꺼져
 * 있는 동안 지나간 더 앞선 슬롯은 따로 돌리지 않습니다. 정기 작업은 오늘 기준으로 상태를 맞추므로 마지막 슬롯 한 번이면 됩니다.
 */
export function latestSlot(spec: ScheduleSpec, now: number): ScheduleSlot {
  const local = new Date(now + COMPANY_OFFSET_MS)
  const [hours, minutes] = parseWallTime(spec.at)
  const year = local.getUTCFullYear()
  const month = local.getUTCMonth()
  if (spec.kind === 'DAILY') {
    const today = slotAt(year, month, local.getUTCDate(), hours, minutes)
    return today.at <= now ? today : slotAt(year, month, local.getUTCDate() - 1, hours, minutes)
  }
  const thisMonth = slotAt(year, month, clampDay(year, month, spec.day), hours, minutes)
  if (thisMonth.at <= now) return thisMonth
  const previous = new Date(Date.UTC(year, month - 1, 1))
  return slotAt(
    previous.getUTCFullYear(),
    previous.getUTCMonth(),
    clampDay(previous.getUTCFullYear(), previous.getUTCMonth(), spec.day),
    hours,
    minutes,
  )
}

function slotAt(year: number, month: number, day: number, hours: number, minutes: number): ScheduleSlot {
  const localMillis = Date.UTC(year, month, day, hours, minutes)
  return { key: new Date(localMillis).toISOString().slice(0, 16), at: localMillis - COMPANY_OFFSET_MS }
}

function clampDay(year: number, month: number, day: number): number {
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return Math.min(Math.max(1, day), last)
}

function parseWallTime(at: WallTime): [number, number] {
  const match = /^(\d{2}):(\d{2})$/.exec(at)
  const hours = Number(match?.[1])
  const minutes = Number(match?.[2])
  if (match === null || hours > 23 || minutes > 59) throw new Error(`Invalid schedule time: ${at}`)
  return [hours, minutes]
}
