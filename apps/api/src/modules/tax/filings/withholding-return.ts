import { addMonths } from '../../../shared/time/calendar.ts'
import type {
  WithholdingIncomeKind,
  WithholdingLineCode,
  WithholdingReturnLine,
  WithholdingSubtotalCode,
  WithholdingTotal,
} from './withholding-return.types.ts'

/**
 * 소득 종류를 원천징수이행상황신고서의 소득구분 코드로 바꾸는 표입니다.
 *
 * 출처: 소득세법 시행규칙 [별지 제21호서식] 원천징수이행상황신고서 <개정 2026. 5. 22.> 제1쪽 "① 원천징수 명세 및 납부세액"의
 * 소득자 소득구분 코드 (https://www.law.go.kr/LSW/flDownload.do?flSeq=164450873).
 *
 * - 근로소득: 간이세액 A01, 중도퇴사 A02, 일용근로 A03, 연말정산 A04~A06, 가감계 A10
 * - 퇴직소득: 연금계좌 A21, 그 외 A22, 가감계 A20. 확정급여형(DB) 퇴직연금에서 주는 퇴직소득도 그 외(A22)에 적습니다(작성방법 3. 가.)
 * - 사업소득: 매월징수 A25, 연말정산 A26~A28, 가감계 A30
 * - 기타소득: 연금계좌 A41, 종교인소득 A43·A44, 가상자산 A49, 인적용역 A59, 그 외 A42, 가감계 A40
 *
 * 대장 행은 연금계좌·종교인소득·인적용역이 아니므로 기타소득은 "그 외" A42 줄에 적습니다. A40은 기타소득의 가감계이고,
 * 납부할 세액은 가감계(A10·A30·A40)를 기준으로 계산합니다(작성방법 3. 라.).
 * 중도퇴사(A02)·연말정산(A04)은 Payroll이 따로 집계하지 않아 근로 행은 모두 간이세액(A01)으로 봅니다.
 */
const 소득구분코드표: Record<
  WithholdingIncomeKind,
  { lineCode: WithholdingLineCode; subtotalCode: WithholdingSubtotalCode }
> = {
  WAGE: { lineCode: 'A01', subtotalCode: 'A10' },
  DAILY: { lineCode: 'A03', subtotalCode: 'A10' },
  RETIREMENT: { lineCode: 'A22', subtotalCode: 'A20' },
  BUSINESS: { lineCode: 'A25', subtotalCode: 'A30' },
  OTHER: { lineCode: 'A42', subtotalCode: 'A40' },
}

/** 소득 종류의 신고서 줄 코드와 그 소득의 가감계 코드입니다. */
export function withholdingLineCodeOf(incomeKind: WithholdingIncomeKind): {
  lineCode: WithholdingLineCode
  subtotalCode: WithholdingSubtotalCode
} {
  return 소득구분코드표[incomeKind]
}

/** 소득 종류별 합계에 신고서 줄 코드를 붙이고, 신고서의 줄 순서(코드 순)로 늘어놓습니다. */
export function withholdingReturnLines(totals: ReadonlyArray<WithholdingTotal>): WithholdingReturnLine[] {
  return totals
    .map((total) => ({ ...withholdingLineCodeOf(total.incomeKind), ...total }))
    .toSorted((a, b) => a.lineCode.localeCompare(b.lineCode))
}

/** 기간 `[periodStart, periodEnd]`(`YYYY-MM-DD`)에 걸친 달(`YYYY-MM`)을 앞에서부터 늘어놓습니다. */
export function monthsBetween(periodStart: string, periodEnd: string): string[] {
  const months: string[] = []
  for (let month = periodStart.slice(0, 7); month <= periodEnd.slice(0, 7); month = addMonths(month, 1)) {
    months.push(month)
  }
  return months
}
