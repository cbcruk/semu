import { addMonths, daysBetween, lastDayOfMonth } from '../../../shared/time/calendar.ts'
import type { BusinessType } from '../../identity-access/actor.types.ts'

/** 예상 부가세가 다루는 기간입니다. 법인은 분기, 개인은 반기입니다. */
export interface VatPeriod {
  start: string
  end: string
  unit: 'QUARTER' | 'HALF'
}

/**
 * 날짜가 속한 예상 부가세 기간입니다. 법인은 분기(예정·확정), 개인은 반기(확정)입니다.
 *
 * @example
 * ```ts
 * vatPeriodContaining('CORPORATION', '2026-11-05') // { start: '2026-10-01', end: '2026-12-31', unit: 'QUARTER' }
 * ```
 */
export function vatPeriodContaining(businessType: BusinessType, date: string): VatPeriod {
  const year = date.slice(0, 4)
  const month = Number(date.slice(5, 7))
  if (businessType === 'CORPORATION') {
    const 분기종료월 = Math.ceil(month / 3) * 3
    const 분기시작월 = `${year}-${String(분기종료월 - 2).padStart(2, '0')}`
    return {
      start: `${분기시작월}-01`,
      end: lastDayOfMonth(`${year}-${String(분기종료월).padStart(2, '0')}`),
      unit: 'QUARTER',
    }
  }
  return month <= 6
    ? { start: `${year}-01-01`, end: `${year}-06-30`, unit: 'HALF' }
    : { start: `${year}-07-01`, end: `${year}-12-31`, unit: 'HALF' }
}

/**
 * 현행 홈 카드의 부가세 납부 기한 근사값입니다. 기간 다음 달 25일이고, 주말·공휴일을 미루지 않습니다.
 *
 * 재설계는 Tax의 세무 일정이 준 실제 기한을 씁니다 (`docs/design/rule-decisions/bookkeeping.md`).
 * 이 함수는 Tax 포트의 가짜와 비교용으로만 남깁니다.
 */
export function approximateVatDueDate(periodEnd: string): string {
  return `${addMonths(periodEnd.slice(0, 7), 1)}-25`
}

/** 오늘부터 기한까지 남은 날입니다. 기한 당일은 0, 지났으면 음수입니다. */
export function daysUntilDue(today: string, dueDate: string): number {
  return daysBetween(today, dueDate)
}
