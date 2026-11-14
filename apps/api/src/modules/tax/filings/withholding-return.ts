import { addMonths } from '../../../shared/time/calendar.ts'
import type {
  OtherIncomeCategory,
  WithholdingIncomeKind,
  WithholdingLineCode,
  WithholdingReturnLine,
  WithholdingSubtotalCode,
  WithholdingTotal,
} from './withholding-return.types.ts'

// 출처(아래에서 "서식"): 소득세법 시행규칙 [별지 제21호서식] 원천징수이행상황신고서 <개정 2026. 5. 22.> 제1쪽
// "① 원천징수 명세 및 납부세액"의 소득자 소득구분 코드와 작성방법 (https://www.law.go.kr/LSW/flDownload.do?flSeq=164450873).
//
// - 근로소득: 간이세액 A01, 중도퇴사 A02, 일용근로 A03, 연말정산 A04~A06, 가감계 A10
// - 퇴직소득: 연금계좌 A21, 그 외 A22, 가감계 A20. 확정급여형(DB) 퇴직연금에서 주는 퇴직소득도 그 외(A22)에 적습니다(작성방법 3. 가.)
// - 사업소득: 매월징수 A25, 연말정산 A26~A28, 가감계 A30
// - 기타소득: 연금계좌 A41, 종교인소득 A43·A44, 가상자산 A49, 인적용역 A59, 그 외 A42, 가감계 A40.
//   인적용역(A59)은 소득세법 제21조제1항제19호의 소득이고 2024. 1. 1. 이후 지급분부터 씁니다(제1쪽 참고사항 5)
//
// 납부할 세액은 가감계(A10·A30·A40)를 기준으로 계산합니다(작성방법 3. 라.).
// 근로 대장 행은 간이세액(A01)이고, 중도퇴사(A02)·연말정산(A04)은 Payroll의 확정 근로소득 정산이 따로 줍니다.
// 연말정산은 A04~A06 중 정기분(A04)만 씁니다. 분납(A05)·납부금액 조정(A06)은 모델링하지 않습니다.
// 정산 줄의 세액은 차감징수세액이라 환급이면 음수입니다. 서식에서 환급을 어느 칸에 적는지는 아직 옮기지 않았습니다.

type LineCodes = { lineCode: WithholdingLineCode; subtotalCode: WithholdingSubtotalCode }

const 소득구분코드표: Record<Exclude<WithholdingIncomeKind, 'OTHER'>, LineCodes> = {
  WAGE: { lineCode: 'A01', subtotalCode: 'A10' },
  WAGE_MID_YEAR_SETTLEMENT: { lineCode: 'A02', subtotalCode: 'A10' },
  DAILY: { lineCode: 'A03', subtotalCode: 'A10' },
  WAGE_ANNUAL_SETTLEMENT: { lineCode: 'A04', subtotalCode: 'A10' },
  RETIREMENT: { lineCode: 'A22', subtotalCode: 'A20' },
  BUSINESS: { lineCode: 'A25', subtotalCode: 'A30' },
}

/** 기타소득은 Payroll이 알려 준 구분으로 줄을 고릅니다. 인적용역이 아닌 기타소득은 "그 외" 줄입니다. */
const 기타소득구분코드표: Record<OtherIncomeCategory, LineCodes> = {
  PERSONAL_SERVICE: { lineCode: 'A59', subtotalCode: 'A40' },
  GENERAL: { lineCode: 'A42', subtotalCode: 'A40' },
}

/** 서식 제1쪽에 줄이 놓인 차례입니다. 기타소득은 인적용역(A59)이 그 외(A42)보다 위에 있어 코드 순서와 다릅니다. */
const 서식줄순서: ReadonlyArray<WithholdingLineCode> = ['A01', 'A02', 'A03', 'A04', 'A22', 'A25', 'A59', 'A42']

/**
 * 소득 종류의 신고서 줄 코드와 그 소득의 가감계 코드입니다. 기타소득은 구분(`otherIncomeCategory`)을 보고, 구분이 없으면
 * 그 외(A42)로 둡니다.
 */
export function withholdingLineCodeOf(
  incomeKind: WithholdingIncomeKind,
  otherIncomeCategory: OtherIncomeCategory | null = null,
): LineCodes {
  if (incomeKind === 'OTHER') return 기타소득구분코드표[otherIncomeCategory ?? 'GENERAL']
  return 소득구분코드표[incomeKind]
}

/** 소득 종류별 합계에 신고서 줄 코드를 붙이고, 서식의 줄 순서로 늘어놓습니다. */
export function withholdingReturnLines(totals: ReadonlyArray<WithholdingTotal>): WithholdingReturnLine[] {
  return totals
    .map((total) => ({ ...withholdingLineCodeOf(total.incomeKind, total.otherIncomeCategory), ...total }))
    .toSorted((a, b) => 서식줄순서.indexOf(a.lineCode) - 서식줄순서.indexOf(b.lineCode))
}

/** 기간 `[periodStart, periodEnd]`(`YYYY-MM-DD`)에 걸친 달(`YYYY-MM`)을 앞에서부터 늘어놓습니다. */
export function monthsBetween(periodStart: string, periodEnd: string): string[] {
  const months: string[] = []
  for (let month = periodStart.slice(0, 7); month <= periodEnd.slice(0, 7); month = addMonths(month, 1)) {
    months.push(month)
  }
  return months
}
