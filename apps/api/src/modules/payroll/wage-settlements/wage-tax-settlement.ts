import { Schema } from 'effect'
import { IdSchema } from '../../../shared/ids/id-schema.ts'
import { CalendarDate, Won } from '../payroll-schema.ts'
import type { WageTaxSettlementRecord } from './wage-tax-settlement.types.ts'

const Kind = Schema.Literals(['MID_YEAR', 'ANNUAL'])
const Status = Schema.Literals(['CALCULATED', 'COMPLETED'])
const Year = Schema.String.pipe(Schema.check(Schema.isPattern(/^\d{4}$/)))

/** 근로자가 소득·세액공제 신고서로 낸 금액 중 엔진이 계산하지 않는 것입니다. */
export const WageSettlementInputSchema = Schema.Struct({
  /** 그 밖의 소득공제 합계(주택자금, 신용카드 등)입니다. */
  otherIncomeDeductions: Schema.optionalKey(Won),
  /** 그 밖의 세액공제 합계(자녀, 연금계좌, 보험료·의료비·교육비·기부금, 월세 등)입니다. */
  otherTaxCredits: Schema.optionalKey(Won),
})

/** `POST /wage-tax-settlements` 본문입니다. */
export const CreateWageTaxSettlement = Schema.Struct({
  kind: Kind,
  employeeId: IdSchema('employee'),
  /** 정산하는 과세연도(`YYYY`)입니다. */
  year: Year,
  input: Schema.optionalKey(WageSettlementInputSchema),
  /** 정산 세액을 지급·징수하는 날입니다. 없으면 확정할 때 중도퇴사는 퇴사일, 연말정산은 다음 해 2월 말일입니다. */
  paymentDate: Schema.optionalKey(CalendarDate),
})

/** `PATCH /wage-tax-settlements/{id}` 본문입니다. 빠진 필드는 그대로 두고, 그해 마감된 대장으로 다시 계산합니다. */
export const UpdateWageTaxSettlement = Schema.Struct({
  input: Schema.optionalKey(WageSettlementInputSchema),
  paymentDate: Schema.optionalKey(Schema.NullOr(CalendarDate)),
})

/** 근로소득 정산 응답입니다. */
export const WageTaxSettlement = Schema.Struct({
  id: IdSchema('wageTaxSettlement'),
  employeeId: IdSchema('employee'),
  employeeName: Schema.String,
  /** 중도퇴사(`MID_YEAR`, 원천세 A02)와 연말정산(`ANNUAL`, A04)입니다. */
  kind: Kind,
  year: Schema.String,
  joinDate: Schema.String,
  leaveDate: Schema.NullOr(Schema.String),
  dependants: Schema.Int,
  input: WageSettlementInputSchema,
  /** 그해 마감된 대장에서 모은 근로소득입니다. */
  totals: Schema.Struct({
    months: Schema.Array(Schema.String),
    grossPay: Schema.Int,
    taxablePay: Schema.Int,
    nationalPension: Schema.Int,
    healthInsurance: Schema.Int,
    employmentInsurance: Schema.Int,
    withheldIncomeTax: Schema.Int,
    withheldLocalIncomeTax: Schema.Int,
  }),
  result: Schema.Struct({
    totalPay: Schema.Int,
    earnedIncomeDeduction: Schema.Int,
    earnedIncome: Schema.Int,
    personalDeduction: Schema.Int,
    pensionDeduction: Schema.Int,
    insuranceDeduction: Schema.Int,
    otherIncomeDeductions: Schema.Int,
    taxBase: Schema.Int,
    calculatedTax: Schema.Int,
    earnedIncomeCredit: Schema.Int,
    standardTaxCredit: Schema.Int,
    otherTaxCredits: Schema.Int,
    deductionMethod: Schema.Literals(['ITEMIZED', 'STANDARD']),
    determinedTax: Schema.Int,
    determinedLocalIncomeTax: Schema.Int,
    withheldIncomeTax: Schema.Int,
    withheldLocalIncomeTax: Schema.Int,
    /** 차감징수세액입니다. 음수면 환급입니다. */
    balanceIncomeTax: Schema.Int,
    balanceLocalIncomeTax: Schema.Int,
  }),
  rateTable: Schema.String,
  paymentDate: Schema.NullOr(Schema.String),
  status: Status,
  allowedActions: Schema.Array(Schema.Literals(['UPDATE', 'COMPLETE', 'REOPEN', 'DELETE'])),
  version: Schema.Int,
  createdAt: Schema.String,
  updatedAt: Schema.String,
})

/** 레코드로 응답을 만듭니다. 계산됨은 수정·확정·삭제, 확정은 다시 열기만 됩니다. */
export function wageSettlementResponse(record: WageTaxSettlementRecord): typeof WageTaxSettlement.Type {
  const { companyId: _, paymentDate, ...rest } = record
  return {
    ...rest,
    paymentDate: paymentDate ?? null,
    allowedActions: record.status === 'CALCULATED' ? ['UPDATE', 'COMPLETE', 'DELETE'] : ['REOPEN'],
  }
}
