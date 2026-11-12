import { Schema } from 'effect'
import { IdSchema } from '../../../shared/ids/id-schema.ts'
import { Won } from '../payroll-schema.ts'
import type { DeductionItemRecord, PaymentItemRecord } from './payroll-item.types.ts'

const NonTaxableCategorySchema = Schema.Literals([
  'MEAL',
  'VEHICLE',
  'CHILDCARE',
  'RESEARCH',
  'OVERSEAS',
  'OVERSEAS_SPECIAL',
  'NIGHT_SHIFT',
  'PARENTAL_LEAVE',
  'TUITION',
  'INVENTION',
])
const AmountModeSchema = Schema.Literals(['FIXED', 'ON_SETTLEMENT'])

/** 표준 지급 항목입니다. 속성은 불러올 때의 기본값입니다. */
export const PaymentItemCategorySchema = Schema.Struct({
  code: Schema.String,
  name: Schema.String,
  nonTaxableCategory: Schema.NullOr(NonTaxableCategorySchema),
  description: Schema.String,
  includeInOrdinaryWage: Schema.Boolean,
  includeInMinimumWage: Schema.Boolean,
  prorate: Schema.Boolean,
})

/** 회사 지급 항목 응답입니다. */
export const PaymentItem = Schema.Struct({
  id: IdSchema('paymentItem'),
  categoryCode: Schema.NullOr(Schema.String),
  name: Schema.String,
  nonTaxableCategory: Schema.NullOr(NonTaxableCategorySchema),
  companyNonTaxableLimit: Schema.NullOr(Schema.Int),
  defaultAmount: Schema.NullOr(Schema.Int),
  includeInOrdinaryWage: Schema.Boolean,
  includeInMinimumWage: Schema.Boolean,
  prorate: Schema.Boolean,
  archivedAt: Schema.NullOr(Schema.String),
  version: Schema.Int,
  createdAt: Schema.String,
  updatedAt: Schema.String,
})

const paymentItemEditable = {
  defaultAmount: Schema.optionalKey(Schema.NullOr(Won)),
  companyNonTaxableLimit: Schema.optionalKey(Schema.NullOr(Won)),
  includeInOrdinaryWage: Schema.optionalKey(Schema.Boolean),
  includeInMinimumWage: Schema.optionalKey(Schema.Boolean),
  prorate: Schema.optionalKey(Schema.Boolean),
}

/**
 * `POST /payroll-payment-items` 본문입니다. 표준 항목을 불러오려면 `categoryCode`를, 과세 항목을 직접 만들려면 `name`을 줍니다.
 * 빠진 속성은 표준 항목의 기본값(직접 만든 항목은 모두 `false`)입니다.
 */
export const CreatePaymentItem = Schema.Struct({
  categoryCode: Schema.optionalKey(Schema.String),
  name: Schema.optionalKey(Schema.String),
  ...paymentItemEditable,
})

/** `PATCH /payroll-payment-items/{itemId}` 본문입니다. 표준 항목은 이름을 바꿀 수 없고, 어느 항목도 표준 항목을 바꿀 수 없습니다. */
export const UpdatePaymentItem = Schema.Struct({
  /** 받기만 하고 바꾸지 않습니다. 지금과 다른 값이면 422 `CATEGORY_FIXED`입니다. */
  categoryCode: Schema.optionalKey(Schema.NullOr(Schema.String)),
  name: Schema.optionalKey(Schema.String),
  ...paymentItemEditable,
})

/** 회사 공제 항목 응답입니다. */
export const DeductionItem = Schema.Struct({
  id: IdSchema('deductionItem'),
  name: Schema.String,
  amountMode: AmountModeSchema,
  amount: Schema.NullOr(Schema.Int),
  archivedAt: Schema.NullOr(Schema.String),
  version: Schema.Int,
  createdAt: Schema.String,
  updatedAt: Schema.String,
})

/** `POST /payroll-deduction-items` 본문입니다. `amountMode`가 없으면 `FIXED`이고 `amount`가 있어야 합니다. */
export const CreateDeductionItem = Schema.Struct({
  name: Schema.String,
  amountMode: Schema.optionalKey(AmountModeSchema),
  amount: Schema.optionalKey(Schema.NullOr(Won)),
})

/** `PATCH /payroll-deduction-items/{itemId}` 본문입니다. `ON_SETTLEMENT`로 바꾸면 금액을 지웁니다. */
export const UpdateDeductionItem = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  amountMode: Schema.optionalKey(AmountModeSchema),
  amount: Schema.optionalKey(Schema.NullOr(Won)),
})

/** 목록 질의입니다. `includeArchived=true`면 지운 항목도 싣습니다. */
export const ItemListQuery = Schema.Struct({
  includeArchived: Schema.optionalKey(Schema.Literals(['true', 'false'])),
})

/** 지급 항목 레코드를 응답으로 바꿉니다. */
export function paymentItemResponse(record: PaymentItemRecord): typeof PaymentItem.Type {
  return {
    id: record.id,
    categoryCode: record.categoryCode,
    name: record.name,
    nonTaxableCategory: record.nonTaxableCategory,
    companyNonTaxableLimit: record.companyNonTaxableLimit,
    defaultAmount: record.defaultAmount,
    includeInOrdinaryWage: record.includeInOrdinaryWage,
    includeInMinimumWage: record.includeInMinimumWage,
    prorate: record.prorate,
    archivedAt: record.archivedAt,
    version: record.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

/** 공제 항목 레코드를 응답으로 바꿉니다. */
export function deductionItemResponse(record: DeductionItemRecord): typeof DeductionItem.Type {
  return {
    id: record.id,
    name: record.name,
    amountMode: record.amountMode,
    amount: record.amount,
    archivedAt: record.archivedAt,
    version: record.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}
