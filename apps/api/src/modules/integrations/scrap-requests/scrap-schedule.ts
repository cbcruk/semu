import type { WallTime } from '../../../shared/scheduler/schedule-slot.ts'
import type { InstitutionType } from '../institutions/institution.ts'

/**
 * 기관 종류별 정기 수집 시각(회사 시간대)입니다. 정책값이라 기관마다 바꿀 수 있습니다.
 *
 * - 은행·빠른조회: 매일 07:00(전날 거래)
 * - 카드사·여신금융협회: 매일 07:30(전날 승인·매출). 은행과 같은 공동인증서로 붙는 기관이 많아 30분 띄웁니다
 * - PG: 매일 10:00·22:00
 * - 배달 플랫폼: 매일 10:00
 * - 올라: 매일 06:00(전날 정산분)
 *
 * 은행·카드는 현행 매뉴얼의 "은행 등록 후 1일 뒤 확인"을 매일 한 번으로 읽었습니다(2026-11-14, #109). 홈택스는 수임동의가 없는
 * 회사의 수집을 거절하는 규칙(docs/design/compliance.md)을 수집 요청이 아직 확인하지 않아 정기 수집에 넣지 않습니다. 지로는 수집이
 * 아니라 납부 경로라 정기 수집이 없습니다.
 */
export const SCHEDULED_SCRAP_TIMES: Readonly<Record<InstitutionType, ReadonlyArray<WallTime>>> = {
  HOMETAX: [],
  CARD_SALES: ['07:30'],
  CREDIT_CARD: ['07:30'],
  BANK: ['07:00'],
  SPEED_BANK: ['07:00'],
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
