import { Schema } from 'effect'
import { RatePpm } from '../payroll-schema.ts'
import { defaultMultipliers } from '../engine/working-time.ts'
import type { PayrollSettingRecord } from './payroll-setting.types.ts'

/** 연장·야간·휴일·휴일연장 지급배수(ppm)입니다. 1.5배는 `1500000`입니다. */
export const PremiumMultipliersSchema = Schema.Struct({
  overtimeRatePpm: RatePpm,
  nightRatePpm: RatePpm,
  holidayRatePpm: RatePpm,
  holidayOvertimeRatePpm: RatePpm,
})

const InsuranceMethod = Schema.Literals(['RATE', 'NOTICE'])
const IncomeTaxMethod = Schema.Literals(['TAX_TABLE', 'MANUAL', 'NONE'])
const DayOfMonth = Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 1, maximum: 31 })))

/** 회사 공제 방식입니다. 4대보험은 요율 계산 또는 공단 고지액, 소득세는 간이세액표·직접 입력·미적용입니다. */
export const DeductionMethodsSchema = Schema.Struct({
  nationalPension: InsuranceMethod,
  healthInsurance: InsuranceMethod,
  employmentInsurance: InsuranceMethod,
  incomeTax: IncomeTaxMethod,
})

/** 급여 설정 응답입니다. 현행 `payroll-terms`·`payroll-deduction`을 하나로 합쳤습니다. */
export const PayrollSetting = Schema.Struct({
  /** 임금산정 기간 시작일입니다. 1이면 그달 1일~말일입니다. */
  wagePeriodStartDay: DayOfMonth,
  /** 귀속월 기준 지급일이 있는 달입니다. */
  paymentMonth: Schema.Literals(['PREVIOUS', 'SAME', 'NEXT']),
  /** 지급일입니다. 그달에 없으면 말일입니다. */
  paymentDay: DayOfMonth,
  /** 상시 5인 미만 사업장인지입니다. 가산수당 기본 배수가 달라집니다. */
  underFiveEmployees: Schema.Boolean,
  multipliers: PremiumMultipliersSchema,
  deductionMethods: DeductionMethodsSchema,
  /** 급여대장 운영 방식입니다. 급여 아웃소싱(`CLIENT_APPROVAL`)은 고객 승인으로 마감합니다. */
  workflow: Schema.Literals(['CLIENT_APPROVAL', 'DIRECT_CLOSE']),
  version: Schema.Int,
  updatedAt: Schema.NullOr(Schema.String),
})

/** `PATCH /payroll-settings` 본문입니다. 보낸 필드만 바꿉니다. */
export const PayrollSettingPatch = Schema.Struct({
  wagePeriodStartDay: Schema.optionalKey(DayOfMonth),
  paymentMonth: Schema.optionalKey(Schema.Literals(['PREVIOUS', 'SAME', 'NEXT'])),
  paymentDay: Schema.optionalKey(DayOfMonth),
  underFiveEmployees: Schema.optionalKey(Schema.Boolean),
  multipliers: Schema.optionalKey(PremiumMultipliersSchema),
  deductionMethods: Schema.optionalKey(DeductionMethodsSchema),
  workflow: Schema.optionalKey(Schema.Literals(['CLIENT_APPROVAL', 'DIRECT_CLOSE'])),
})

/**
 * 아직 저장한 적 없는 회사의 기본 설정입니다. 현행 마이그레이션 기본값을 따릅니다.
 *
 * 매월 1일 시작, 같은 달 25일 지급, 5인 이상 배수, 국민연금·건강보험은 고지액, 고용보험은 요율, 소득세는 간이세액표입니다.
 */
export function defaultPayrollSetting(): PayrollSettingRecord {
  return {
    wagePeriodStartDay: 1,
    paymentMonth: 'SAME',
    paymentDay: 25,
    underFiveEmployees: false,
    multipliers: defaultMultipliers(false),
    deductionMethods: {
      nationalPension: 'NOTICE',
      healthInsurance: 'NOTICE',
      employmentInsurance: 'RATE',
      incomeTax: 'TAX_TABLE',
    },
    workflow: 'DIRECT_CLOSE',
    version: 0,
    updatedAt: null,
  }
}

/**
 * 설정에 고침을 적용합니다. 5인 미만 여부만 바꾸고 배수를 보내지 않으면 배수를 새 규모의 기본값으로 바꿉니다.
 */
export function applyPayrollSettingPatch(
  current: PayrollSettingRecord,
  patch: typeof PayrollSettingPatch.Type,
  now: string,
): PayrollSettingRecord {
  const underFiveChanged =
    patch.underFiveEmployees !== undefined && patch.underFiveEmployees !== current.underFiveEmployees
  const multipliers =
    patch.multipliers ??
    (underFiveChanged ? defaultMultipliers(patch.underFiveEmployees ?? false) : current.multipliers)
  return {
    ...current,
    ...patch,
    multipliers: { ...multipliers },
    version: current.version + 1,
    updatedAt: now,
  }
}
