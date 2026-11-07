import type { Plan } from '../identity-access/actor.types.ts'

/**
 * 급여대장·행·명세서와 인건비 보고서를 여는 플랜입니다. 급여·세무 중 하나만 구독해도 됩니다.
 *
 * 현행 급여 관리(`payroll_management`)는 세무 기장(`TAXATION`) 메뉴였고, 급여 아웃소싱(`PAYROLL`)은 급여 정산
 * (`payroll_settlement`)으로 같은 대장을 썼습니다. 2026-11-07에 기장 고객을 `PAYROLL`로 옮기지 않고 두 플랜 모두에 열기로
 * 정했습니다. 급여 설정·퇴직금·기준표·계산기는 현행 메뉴처럼 `PAYROLL`만 엽니다.
 */
export const LEDGER_PLANS: ReadonlyArray<Plan> = ['PAYROLL', 'TAXATION']
