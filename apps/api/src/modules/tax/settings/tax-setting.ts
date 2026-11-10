import { Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import { problemType } from '../../../shared/problem/problem.ts'
import type { TaxSettingRecord } from './tax-setting.types.ts'

const WithholdingCycle = Schema.Literals(['MONTHLY', 'SEMIANNUAL'])
const VatTaxpayerType = Schema.Literals(['GENERAL', 'SIMPLIFIED'])
const VatPreliminaryElectionReason = Schema.Literals(['BUSINESS_DECLINE', 'EARLY_REFUND'])
/** 과세기간 키(`2026-H2`) → 공급가액 합계액(원)입니다. 키와 음수는 규칙(422)이 봅니다. */
const VatSupplyAmounts = Schema.Record(Schema.String, Schema.Int)
/** 과세기간 키(`2027-H1`) → 예정신고 선택 사유입니다. */
const VatPreliminaryElections = Schema.Record(Schema.String, VatPreliminaryElectionReason)

/** 회사 세무 설정 응답입니다. 회사마다 한 건이고, 저장한 적 없으면 기본 설정(`version: 0`)입니다. */
export const TaxSetting = Schema.Struct({
  /** 사업연도 종료 월(1–12)입니다. 법인세 기간과 기한을 정합니다. 개인사업자는 12입니다. */
  fiscalYearEndMonth: Schema.Int,
  /** 원천세 납부 주기입니다. 반기별 납부 승인을 받은 사업장만 `SEMIANNUAL`입니다. */
  withholdingCycle: WithholdingCycle,
  /**
   * 반기별 납부를 적용하기 시작하는 반기(`2027-H1`)입니다. 승인받은 날이 속한 반기의 다음 반기이고(소득세법 제128조 ②,
   * 시행령 제186조), 그 앞은 매월 납부로 계산합니다. 반기 납부면 필수, 매월 납부면 `null`입니다.
   */
  withholdingSemiannualFrom: Schema.NullOr(Schema.String),
  /** 성실신고확인 대상이면 법인세·종합소득세 기한이 한 달 늦습니다. */
  sincereFilingTarget: Schema.Boolean,
  /** 부가세 과세 유형입니다. 간이과세자(`SIMPLIFIED`)는 개인사업자만 됩니다. */
  vatTaxpayerType: VatTaxpayerType,
  /** 간이과세자가 예정부과기간(1–6월)에 세금계산서를 발급했는지입니다. 참이면 예정부과 고지 대신 예정 신고입니다. */
  vatSimplifiedInvoiceIssuer: Schema.Boolean,
  /** 카드 매출 중 과세 매출 비율입니다. ppm(100% = 1,000,000)입니다. */
  taxableCardRatioPpm: Schema.Int,
  /** 일반과세자 과세기간별 공급가액 합계액(원)입니다. 다음 과세기간의 예정고지 판정에 씁니다. */
  vatSupplyAmounts: VatSupplyAmounts,
  /** 예정고지 대신 예정신고를 고른 과세기간과 사유입니다. */
  vatPreliminaryElections: VatPreliminaryElections,
  version: Schema.Int,
  updatedAt: Schema.NullOr(Schema.String),
})

/** `PATCH /tax-settings` 본문입니다. 보낸 필드만 바꿉니다. 과세기간별 값(`vatSupplyAmounts`·`vatPreliminaryElections`)은 보낸 값으로 통째로 바꿉니다. */
export const TaxSettingPatch = Schema.Struct({
  fiscalYearEndMonth: Schema.optionalKey(Schema.Int),
  withholdingCycle: Schema.optionalKey(WithholdingCycle),
  withholdingSemiannualFrom: Schema.optionalKey(Schema.NullOr(Schema.String)),
  sincereFilingTarget: Schema.optionalKey(Schema.Boolean),
  vatTaxpayerType: Schema.optionalKey(VatTaxpayerType),
  vatSimplifiedInvoiceIssuer: Schema.optionalKey(Schema.Boolean),
  taxableCardRatioPpm: Schema.optionalKey(Schema.Int),
  vatSupplyAmounts: Schema.optionalKey(VatSupplyAmounts),
  vatPreliminaryElections: Schema.optionalKey(VatPreliminaryElections),
})

/** 세무 설정이 사업자 형태나 법령에 맞지 않습니다. 이유는 `reason`, 걸린 필드는 `field`입니다. */
export class TaxSettingInvalid extends HttpApiError.Problem<TaxSettingInvalid>()(
  'TaxSettingInvalid',
  { type: problemType('TAX_SETTING_INVALID'), status: 422, title: 'Tax setting is not valid for this company' },
  {
    code: Schema.tag('TAX_SETTING_INVALID'),
    reason: Schema.Literals([
      'FISCAL_YEAR_END_MONTH_OUT_OF_RANGE',
      'SEMIANNUAL_START_REQUIRED',
      'SEMIANNUAL_START_NOT_ALLOWED',
      'INDIVIDUAL_FISCAL_YEAR_NOT_CALENDAR',
      'CORPORATION_CANNOT_BE_SIMPLIFIED',
      'INVOICE_ISSUER_REQUIRES_SIMPLIFIED',
      'TAXABLE_CARD_RATIO_OUT_OF_RANGE',
      'PERIOD_KEY_INVALID',
      'VAT_SUPPLY_AMOUNT_INVALID',
    ]),
    field: Schema.String,
  },
) {}

/**
 * 아직 저장한 적 없는 회사의 기본 세무 설정입니다. 세무 설정 저장소가 생기기 전 모든 회사가 쓰던 값과 같습니다.
 *
 * 12월 결산, 매월 원천세, 성실신고확인 대상 아님, 일반과세자, 카드 매출 전부 과세입니다. 과세기간별 공급가액과
 * 예정신고 선택이 없어 부가세 예정 기간은 법인이 신고, 개인이 고지입니다.
 */
export function defaultTaxSetting(): TaxSettingRecord {
  return {
    fiscalYearEndMonth: 12,
    withholdingCycle: 'MONTHLY',
    withholdingSemiannualFrom: null,
    sincereFilingTarget: false,
    vatTaxpayerType: 'GENERAL',
    vatSimplifiedInvoiceIssuer: false,
    taxableCardRatioPpm: 1_000_000,
    vatSupplyAmounts: {},
    vatPreliminaryElections: {},
    version: 0,
    updatedAt: null,
  }
}

/** 설정에 고침을 적용합니다. 검증은 하지 않으므로 결과를 `validateTaxSetting`으로 봅니다. */
export function applyTaxSettingPatch(
  current: TaxSettingRecord,
  patch: typeof TaxSettingPatch.Type,
  now: string,
): TaxSettingRecord {
  return {
    ...current,
    ...patch,
    vatSupplyAmounts: { ...(patch.vatSupplyAmounts ?? current.vatSupplyAmounts) },
    vatPreliminaryElections: { ...(patch.vatPreliminaryElections ?? current.vatPreliminaryElections) },
    version: current.version + 1,
    updatedAt: now,
  }
}
