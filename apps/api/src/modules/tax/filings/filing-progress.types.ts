/**
 * 고객 화면의 진행 단계입니다.
 *
 * - `MATERIALS_OPEN`: 자료 제출 가능
 * - `UNDER_REVIEW`: 자료 검토중
 * - `LEDGER_CONFIRMATION`: 매입매출장 확인 (부가세만)
 * - `PREPARING`: 작업중
 * - `PAYMENT`: 납부
 * - `CLOSED`: 마감
 */
export type FilingStage = 'MATERIALS_OPEN' | 'UNDER_REVIEW' | 'LEDGER_CONFIRMATION' | 'PREPARING' | 'PAYMENT' | 'CLOSED'

/** 진행 막대에 그릴 단계와 1부터 센 위치, 전체 단계 수입니다. */
export interface FilingProgress {
  stage: FilingStage | null
  index: number
  count: number
}
