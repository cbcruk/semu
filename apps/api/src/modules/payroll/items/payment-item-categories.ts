import type { NonTaxableCategory } from '../engine/rate-table.types.ts'
import type { PaymentItemCategory } from './payroll-item.types.ts'

/** 매달 정해진 금액을 주는 수당의 기본 속성입니다. 통상임금·최저임금에 넣고 일할계산하지 않습니다. */
const 정기수당 = { includeInOrdinaryWage: true, includeInMinimumWage: true, prorate: false } as const

/** 실적·사유가 있을 때만 주거나 연장근로의 대가인 수당의 기본 속성입니다. 어디에도 넣지 않습니다. */
const 비정기수당 = { includeInOrdinaryWage: false, includeInMinimumWage: false, prorate: false } as const

function 비과세(
  code: NonTaxableCategory,
  name: string,
  description: string,
  defaults: typeof 정기수당 | typeof 비정기수당,
): PaymentItemCategory {
  return { code, name, nonTaxableCategory: code, description, ...defaults }
}

function 과세(code: string, name: string, description: string): PaymentItemCategory {
  return { code, name, nonTaxableCategory: null, description, ...비정기수당 }
}

/**
 * 표준 지급 항목입니다. 회사 항목을 "불러오기"로 만들 때 고르는 목록입니다(현행 `GET /payroll-payment-categories/`).
 *
 * 비과세 항목과 연차수당, 고정 연장·야간·휴일 수당은 표준 항목으로만 만들 수 있습니다. 비과세 유형과 이름이 신고·회계
 * 코드와 이어지기 때문입니다(현행 매뉴얼 "비과세 항목명은 표준명 필수"). 기본급과 연장·야간·휴일·휴일연장 가산수당은
 * 엔진이 근무 시간으로 만드는 줄이라 항목이 아닙니다.
 *
 * 통상임금·최저임금 산입의 기본값은 출발점일 뿐이고 회사가 항목마다 고칩니다.
 * - 통상임금: 소정근로의 대가로 정기적·일률적으로 주면 넣습니다. 고정성은 요건이 아닙니다(대법원 2024. 12. 19. 선고
 *   2020다247190 전원합의체 판결). 연장근로의 대가(고정 연장 수당 등)와 연차수당은 소정근로의 대가가 아닙니다
 * - 최저임금: 매월 1회 이상 정기적으로 주는 임금을 넣고, 연장·휴일·야간 가산과 연차수당은 뺍니다(최저임금법 제6조제4항,
 *   같은 법 시행규칙 제2조). 2024년부터 현금으로 주는 복리후생비는 전액 넣습니다
 */
export const PAYMENT_ITEM_CATEGORIES: ReadonlyArray<PaymentItemCategory> = [
  비과세('MEAL', '식대', '월 20만원까지 비과세입니다(소득세법 제12조제3호러목).', 정기수당),
  비과세(
    'VEHICLE',
    '자가운전보조금',
    '본인 차량으로 업무에 쓰는 실비 대신 받는 금액으로 월 20만원까지 비과세입니다.',
    정기수당,
  ),
  비과세(
    'CHILDCARE',
    '보육수당',
    '6세 이하 자녀 1명당 월 20만원까지 비과세입니다. 자녀 수는 HR 직원 정보에서 옵니다.',
    정기수당,
  ),
  비과세('RESEARCH', '연구보조비', '연구활동비로 월 20만원까지 비과세입니다.', 정기수당),
  비과세('OVERSEAS', '국외근로수당', '국외 근로 보수로 월 100만원까지 비과세입니다.', 정기수당),
  비과세(
    'OVERSEAS_SPECIAL',
    '국외근로수당(원양어업·외항선·해외건설)',
    '원양어업 선박, 국외 항행 선박, 국외 건설현장 근로로 월 500만원까지 비과세입니다.',
    정기수당,
  ),
  비과세(
    'NIGHT_SHIFT',
    '생산직 연장근로수당',
    '월정액급여 260만원 이하 생산직의 연장·야간·휴일근로 수당으로 연 240만원까지 비과세입니다. 요건은 담당자가 확인합니다.',
    비정기수당,
  ),
  비과세('PARENTAL_LEAVE', '육아휴직급여', '고용보험법에 따른 육아휴직 급여로 전액 비과세입니다.', 비정기수당),
  비과세('TUITION', '학자금', '요건을 갖춘 학자금으로 그 과세기간에 낼 금액까지 비과세입니다.', 비정기수당),
  비과세('INVENTION', '직무발명보상금', '연 700만원까지 비과세입니다.', 비정기수당),
  과세('ANNUAL_LEAVE_PAY', '연차수당', '쓰지 않은 연차휴가에 주는 수당입니다.'),
  과세('FIXED_OVERTIME_PAY', '고정연장근로수당', '약정한 연장근로 시간에 매달 정해 주는 수당입니다.'),
  과세('FIXED_NIGHT_PAY', '고정야간근로수당', '약정한 야간근로 시간에 매달 정해 주는 수당입니다.'),
  과세('FIXED_HOLIDAY_PAY', '고정휴일근로수당', '약정한 휴일근로 시간에 매달 정해 주는 수당입니다.'),
  과세('FIXED_HOLIDAY_OVERTIME_PAY', '고정휴일연장근로수당', '약정한 휴일연장근로 시간에 매달 정해 주는 수당입니다.'),
]

/** 코드로 표준 항목을 찾습니다. 없으면 `undefined`입니다. */
export function findPaymentItemCategory(code: string): PaymentItemCategory | undefined {
  return PAYMENT_ITEM_CATEGORIES.find((category) => category.code === code)
}
