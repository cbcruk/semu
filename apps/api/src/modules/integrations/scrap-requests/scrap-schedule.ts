import type { WallTime } from '../../../shared/scheduler/schedule-slot.ts'
import type { InstitutionType } from '../institutions/institution.ts'

/**
 * 기관 종류별 정기 수집 시각(회사 시간대)입니다. 정책값이라 기관마다 바꿀 수 있습니다.
 *
 * - PG: 매일 10:00·22:00
 * - 배달 플랫폼: 매일 10:00
 * - 올라: 매일 06:00(전날 정산분)
 *
 * 나머지(홈택스·카드·은행·지로)는 사용자가 수동 수집하거나 연동 등록 때 첫 수집을 합니다. 은행의 "등록 후 1일" 주기는 아직 정하지 않았습니다.
 */
export const SCHEDULED_SCRAP_TIMES: Readonly<Record<InstitutionType, ReadonlyArray<WallTime>>> = {
  HOMETAX: [],
  CARD_SALES: [],
  CREDIT_CARD: [],
  BANK: [],
  SPEED_BANK: [],
  GIRO: [],
  PG: ['10:00', '22:00'],
  DELIVERY: ['10:00'],
  ALLRA: ['06:00'],
}

/** 정기 수집 시각 하나입니다. 작업 이름은 `integrations.scrap.<기관 종류 소문자>-<HHMM>`입니다. */
export interface ScheduledScrap {
  readonly name: string
  readonly institutionType: InstitutionType
  readonly at: WallTime
}

/** {@link SCHEDULED_SCRAP_TIMES}를 작업 하나씩으로 폅니다. */
export function scheduledScraps(
  times: Readonly<Record<InstitutionType, ReadonlyArray<WallTime>>> = SCHEDULED_SCRAP_TIMES,
): ScheduledScrap[] {
  return Object.entries(times).flatMap(([type, ats]) =>
    ats.map((at) => ({
      name: `integrations.scrap.${type.toLowerCase().replace('_', '-')}-${at.replace(':', '')}`,
      institutionType: type as InstitutionType,
      at,
    })),
  )
}
