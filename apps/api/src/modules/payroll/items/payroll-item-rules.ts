import type { Id } from '../../../shared/ids/ids.types.ts'
import type { OtherDeductionInput, PaymentItemInput } from '../engine/engine.types.ts'
import { findPaymentItemCategory, PAYMENT_ITEM_CATEGORIES } from './payment-item-categories.ts'
import type {
  DeductionAmountMode,
  DeductionItemRecord,
  PayrollItemCatalog,
  PayrollItemViolation,
  PaymentItemRecord,
} from './payroll-item.types.ts'

/** 지급 항목에서 사용자가 정하는 값입니다. ID·버전·시각은 유스케이스가 채웁니다. */
export type PaymentItemFields = Pick<
  PaymentItemRecord,
  | 'categoryCode'
  | 'name'
  | 'nonTaxableCategory'
  | 'companyNonTaxableLimit'
  | 'defaultAmount'
  | 'includeInOrdinaryWage'
  | 'includeInMinimumWage'
  | 'prorate'
>

/** 지급 항목 입력입니다. 만들 때는 `categoryCode`를 받을 수 있고, 고칠 때는 받지 않습니다. */
export interface PaymentItemInputFields {
  categoryCode?: string | null
  name?: string
  defaultAmount?: number | null
  companyNonTaxableLimit?: number | null
  includeInOrdinaryWage?: boolean
  includeInMinimumWage?: boolean
  prorate?: boolean
}

/** 공제 항목에서 사용자가 정하는 값입니다. */
export type DeductionItemFields = Pick<DeductionItemRecord, 'name' | 'amountMode' | 'amount'>

/** 공제 항목 입력입니다. */
export interface DeductionItemInputFields {
  name?: string
  amountMode?: DeductionAmountMode
  amount?: number | null
}

/** 규칙을 통과한 값이거나 위반 목록입니다. */
export type FieldsOrViolations<T> =
  { ok: true; fields: T } | { ok: false; violations: ReadonlyArray<PayrollItemViolation> }

/** 엔진이 근무 시간으로 만드는 지급 줄의 이름입니다. 회사 지급 항목이 이 이름을 쓰면 명세서에서 둘을 가를 수 없습니다. */
const 엔진지급이름 = new Set([
  '기본급',
  '주휴수당',
  '연장근로수당',
  '야간근로수당',
  '휴일근로수당',
  '휴일연장근로수당',
  '근태공제',
])

/**
 * 엔진이 행에서 따로 만드는 공제 줄의 이름입니다. 회사 공제 항목이 이 이름을 쓰면 명세서에서 둘을 가를 수 없습니다.
 */
const 법정공제이름 = new Set([
  '국민연금',
  '건강보험',
  '장기요양보험',
  '고용보험',
  '소득세',
  '근로소득세',
  '지방소득세',
  '근태공제',
])

/**
 * 지급 항목 입력에 규칙을 적용합니다. `current`가 없으면 새 항목이고, 있으면 그 항목을 고칩니다.
 *
 * - 표준 항목(`categoryCode`)을 불러오면 이름과 비과세 유형은 표준 항목 그대로이고, 속성의 기본값도 표준 항목에서 옵니다
 * - 직접 만든 항목은 과세 항목입니다. 이름이 비면 안 되고 표준 항목 이름이나 엔진이 만드는 지급 줄 이름(기본급·연장근로수당 등)을
 *   쓸 수 없습니다. 비과세·연차수당은 표준 이름으로만 만듭니다
 * - 표준 항목은 만든 뒤 바꿀 수 없습니다(고칠 때 다른 `categoryCode`를 주면 `CATEGORY_FIXED`)
 * - 회사 비과세 한도는 비과세 항목에만 둡니다
 * - 이름은 회사의 지우지 않은 지급 항목 사이에서 겹치지 않습니다(`others`에 자기 자신이 있어도 됩니다)
 */
export function paymentItemFieldsOf(
  input: PaymentItemInputFields,
  current: (PaymentItemFields & { id?: string }) | undefined,
  others: ReadonlyArray<PaymentItemRecord>,
): FieldsOrViolations<PaymentItemFields> {
  const violations: PayrollItemViolation[] = []
  let 기준값: PaymentItemFields
  if (current !== undefined) {
    기준값 = current
    if (input.categoryCode !== undefined && input.categoryCode !== current.categoryCode) {
      violations.push({ field: 'categoryCode', code: 'CATEGORY_FIXED' })
    }
  } else if (input.categoryCode !== undefined && input.categoryCode !== null) {
    const 표준항목 = findPaymentItemCategory(input.categoryCode)
    if (표준항목 === undefined) return { ok: false, violations: [{ field: 'categoryCode', code: 'UNKNOWN_CATEGORY' }] }
    기준값 = {
      categoryCode: 표준항목.code,
      name: 표준항목.name,
      nonTaxableCategory: 표준항목.nonTaxableCategory,
      companyNonTaxableLimit: null,
      defaultAmount: null,
      includeInOrdinaryWage: 표준항목.includeInOrdinaryWage,
      includeInMinimumWage: 표준항목.includeInMinimumWage,
      prorate: 표준항목.prorate,
    }
  } else {
    기준값 = {
      categoryCode: null,
      name: '',
      nonTaxableCategory: null,
      companyNonTaxableLimit: null,
      defaultAmount: null,
      includeInOrdinaryWage: false,
      includeInMinimumWage: false,
      prorate: false,
    }
  }

  let name = 기준값.name
  if (input.name !== undefined) {
    const 다듬은이름 = input.name.trim()
    if (기준값.categoryCode !== null) {
      if (다듬은이름 !== 기준값.name) violations.push({ field: 'name', code: 'NAME_FIXED' })
    } else {
      name = 다듬은이름
    }
  }
  if (기준값.categoryCode === null) {
    if (name === '') violations.push({ field: 'name', code: 'REQUIRED' })
    else if (PAYMENT_ITEM_CATEGORIES.some((category) => category.name === name)) {
      violations.push({ field: 'name', code: 'STANDARD_NAME_RESERVED' })
    } else if (엔진지급이름.has(name)) violations.push({ field: 'name', code: 'RESERVED_NAME' })
  }

  const companyNonTaxableLimit =
    input.companyNonTaxableLimit === undefined ? 기준값.companyNonTaxableLimit : input.companyNonTaxableLimit
  if (companyNonTaxableLimit !== null && 기준값.nonTaxableCategory === null) {
    violations.push({ field: 'companyNonTaxableLimit', code: 'NOT_APPLICABLE' })
  }

  const 이름위반 = violations.some((violation) => violation.field === 'name')
  if (
    !이름위반 &&
    others.some((other) => other.id !== current?.id && other.archivedAt === null && other.name === name)
  ) {
    violations.push({ field: 'name', code: 'DUPLICATED' })
  }
  if (violations.length > 0) return { ok: false, violations }
  return {
    ok: true,
    fields: {
      categoryCode: 기준값.categoryCode,
      name,
      nonTaxableCategory: 기준값.nonTaxableCategory,
      companyNonTaxableLimit,
      defaultAmount: input.defaultAmount === undefined ? 기준값.defaultAmount : input.defaultAmount,
      includeInOrdinaryWage: input.includeInOrdinaryWage ?? 기준값.includeInOrdinaryWage,
      includeInMinimumWage: input.includeInMinimumWage ?? 기준값.includeInMinimumWage,
      prorate: input.prorate ?? 기준값.prorate,
    },
  }
}

/**
 * 공제 항목 입력에 규칙을 적용합니다. `current`가 없으면 새 항목입니다.
 *
 * - 이름은 비면 안 되고, 엔진이 만드는 공제 줄 이름(국민연금·소득세 등)을 쓸 수 없고, 지우지 않은 공제 항목 사이에서 겹치지 않습니다
 * - `FIXED`는 금액이 있어야 하고, `ON_SETTLEMENT`는 금액이 없습니다. `ON_SETTLEMENT`로 바꾸면 금액을 지웁니다
 */
export function deductionItemFieldsOf(
  input: DeductionItemInputFields,
  current: (DeductionItemFields & { id?: string }) | undefined,
  others: ReadonlyArray<DeductionItemRecord>,
): FieldsOrViolations<DeductionItemFields> {
  const violations: PayrollItemViolation[] = []
  const name = input.name === undefined ? (current?.name ?? '') : input.name.trim()
  if (name === '') violations.push({ field: 'name', code: 'REQUIRED' })
  else if (법정공제이름.has(name)) violations.push({ field: 'name', code: 'RESERVED_NAME' })
  else if (others.some((other) => other.id !== current?.id && other.archivedAt === null && other.name === name)) {
    violations.push({ field: 'name', code: 'DUPLICATED' })
  }

  const amountMode = input.amountMode ?? current?.amountMode ?? 'FIXED'
  let amount: number | null
  if (amountMode === 'ON_SETTLEMENT') {
    if (input.amount !== undefined && input.amount !== null)
      violations.push({ field: 'amount', code: 'NOT_APPLICABLE' })
    amount = null
  } else {
    amount = input.amount === undefined ? (current?.amount ?? null) : input.amount
    if (amount === null) violations.push({ field: 'amount', code: 'REQUIRED' })
  }
  if (violations.length > 0) return { ok: false, violations }
  return { ok: true, fields: { name, amountMode, amount } }
}

/** 행이 항목을 가리키는 값입니다. */
export interface ItemRef {
  itemId: string
  amount: number
}

/** 행 입력 중 항목을 가리키는 부분입니다. 근로 행만 지급 항목이 있습니다. */
export interface RowItemRefs {
  paymentItems?: ReadonlyArray<ItemRef>
  otherDeductions?: ReadonlyArray<ItemRef>
}

/** 행이 가리키는 항목의 위반입니다. */
export interface RowItemViolation {
  field: string
  code: 'NOT_FOUND' | 'ARCHIVED' | 'DUPLICATED'
}

/**
 * 행이 가리키는 항목을 카탈로그와 맞춰 봅니다. 위반이 없으면 빈 배열입니다.
 *
 * 지운 항목은 새로 넣을 수 없지만, 고치기 전 행(`previous`)에 이미 있던 항목은 그대로 둘 수 있습니다. 항목을 지워도
 * 그 항목을 쓰던 입력 중 대장의 다른 값을 고칠 수 있게 하기 위해서입니다. 한 행에 같은 항목은 한 번만 넣습니다.
 */
export function rowItemViolations(
  input: RowItemRefs,
  previous: RowItemRefs | undefined,
  catalog: PayrollItemCatalog,
): RowItemViolation[] {
  return [
    ...목록위반('paymentItems', input.paymentItems, previous?.paymentItems, catalog.paymentItems),
    ...목록위반('otherDeductions', input.otherDeductions, previous?.otherDeductions, catalog.deductionItems),
  ]
}

function 목록위반(
  key: 'paymentItems' | 'otherDeductions',
  refs: ReadonlyArray<ItemRef> | undefined,
  previous: ReadonlyArray<ItemRef> | undefined,
  items: ReadonlyMap<string, { archivedAt: string | null }>,
): RowItemViolation[] {
  const 이전항목 = new Set((previous ?? []).map((ref) => ref.itemId))
  const 본항목 = new Set<string>()
  const violations: RowItemViolation[] = []
  for (const [index, ref] of (refs ?? []).entries()) {
    const field = `input.${key}[${index}].itemId`
    const item = items.get(ref.itemId)
    if (item === undefined) violations.push({ field, code: 'NOT_FOUND' })
    else if (item.archivedAt !== null && !이전항목.has(ref.itemId)) violations.push({ field, code: 'ARCHIVED' })
    else if (본항목.has(ref.itemId)) violations.push({ field, code: 'DUPLICATED' })
    본항목.add(ref.itemId)
  }
  return violations
}

/**
 * 행의 지급 항목을 엔진 입력으로 풉니다. 이름·비과세 유형·한도·통상임금·최저임금·일할계산은 계산하는 때의 카탈로그에서 옵니다.
 * 결과 줄의 `code`는 항목 ID입니다.
 *
 * 카탈로그에 없는 항목은 쓰기 규칙({@link rowItemViolations})이 막으므로 생기지 않지만, 생기면 ID를 이름으로 한 과세 항목으로 봅니다.
 */
export function enginePaymentItems(refs: ReadonlyArray<ItemRef>, catalog: PayrollItemCatalog): PaymentItemInput[] {
  return refs.map((ref) => {
    const item = catalog.paymentItems.get(ref.itemId)
    if (item === undefined) return { code: ref.itemId, name: ref.itemId, amount: ref.amount }
    return {
      code: item.id,
      name: item.name,
      amount: ref.amount,
      ...(item.nonTaxableCategory === null ? {} : { nonTaxableCategory: item.nonTaxableCategory }),
      ...(item.companyNonTaxableLimit === null ? {} : { companyNonTaxableLimit: item.companyNonTaxableLimit }),
      includeInOrdinaryWage: item.includeInOrdinaryWage,
      includeInMinimumWage: item.includeInMinimumWage,
      prorate: item.prorate,
    }
  })
}

/** 행의 공제 항목을 엔진 입력으로 풉니다. 이름은 계산하는 때의 카탈로그에서 옵니다. */
export function engineDeductions(refs: ReadonlyArray<ItemRef>, catalog: PayrollItemCatalog): OtherDeductionInput[] {
  return refs.map((ref) => ({
    code: ref.itemId,
    name: catalog.deductionItems.get(ref.itemId)?.name ?? ref.itemId,
    amount: ref.amount,
  }))
}

/**
 * 정기 대장을 만들 때 근로 행에 미리 넣는 항목입니다. 지우지 않은 지급 항목 중 기본 금액이 있는 것과 `FIXED` 공제 항목입니다.
 * 만든 순서입니다.
 */
export function defaultRowItems(catalog: PayrollItemCatalog): {
  paymentItems: Array<{ itemId: Id<'paymentItem'>; amount: number }>
  otherDeductions: Array<{ itemId: Id<'deductionItem'>; amount: number }>
} {
  const 만든순서 = <T extends { createdAt: string; id: string }>(a: T, b: T) =>
    a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
  return {
    paymentItems: [...catalog.paymentItems.values()]
      .filter((item) => item.archivedAt === null && item.defaultAmount !== null)
      .toSorted(만든순서)
      .map((item) => ({ itemId: item.id, amount: item.defaultAmount ?? 0 })),
    otherDeductions: [...catalog.deductionItems.values()]
      .filter((item) => item.archivedAt === null && item.amountMode === 'FIXED' && item.amount !== null)
      .toSorted(만든순서)
      .map((item) => ({ itemId: item.id, amount: item.amount ?? 0 })),
  }
}

/** 카탈로그를 레코드 목록으로 만듭니다. */
export function catalogOf(
  paymentItems: ReadonlyArray<PaymentItemRecord>,
  deductionItems: ReadonlyArray<DeductionItemRecord>,
): PayrollItemCatalog {
  return {
    paymentItems: new Map(paymentItems.map((item) => [item.id, item])),
    deductionItems: new Map(deductionItems.map((item) => [item.id, item])),
  }
}

/** 항목이 하나도 없는 카탈로그입니다. */
export const EMPTY_CATALOG: PayrollItemCatalog = catalogOf([], [])
