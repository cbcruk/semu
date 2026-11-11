import type { Id } from '../../../shared/ids/ids.types.ts'
import { findPaymentItemCategory } from './payment-item-categories.ts'
import type { DeductionItemRecord, PaymentItemRecord } from './payroll-item.types.ts'

const COMPANY = 'cmp_test' as Id<'company'>
const CREATED_AT = '2026-01-01T00:00:00.000Z'

/**
 * 표준 항목을 불러온 지급 항목 레코드입니다. 순수 함수 테스트에서 카탈로그를 만들 때 씁니다.
 *
 * @example
 * ```ts
 * const meal = categoryPaymentItem('MEAL', { id: 'pit_meal' })
 * ```
 */
export function categoryPaymentItem(
  categoryCode: string,
  overrides: Partial<PaymentItemRecord> = {},
): PaymentItemRecord {
  const category = findPaymentItemCategory(categoryCode)
  if (category === undefined) throw new Error(`표준 항목이 없습니다: ${categoryCode}`)
  return {
    id: `pit_${categoryCode.toLowerCase()}` as Id<'paymentItem'>,
    companyId: COMPANY,
    categoryCode: category.code,
    name: category.name,
    nonTaxableCategory: category.nonTaxableCategory,
    companyNonTaxableLimit: null,
    defaultAmount: null,
    includeInOrdinaryWage: category.includeInOrdinaryWage,
    includeInMinimumWage: category.includeInMinimumWage,
    prorate: category.prorate,
    archivedAt: null,
    version: 1,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  }
}

/** 회사가 직접 만든 과세 지급 항목 레코드입니다. */
export function customPaymentItem(name: string, overrides: Partial<PaymentItemRecord> = {}): PaymentItemRecord {
  return {
    id: 'pit_custom' as Id<'paymentItem'>,
    companyId: COMPANY,
    categoryCode: null,
    name,
    nonTaxableCategory: null,
    companyNonTaxableLimit: null,
    defaultAmount: null,
    includeInOrdinaryWage: false,
    includeInMinimumWage: false,
    prorate: false,
    archivedAt: null,
    version: 1,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  }
}

/** 공제 항목 레코드입니다. 기본은 매달 10,000원 고정입니다. */
export function deductionItem(name: string, overrides: Partial<DeductionItemRecord> = {}): DeductionItemRecord {
  return {
    id: 'dit_test' as Id<'deductionItem'>,
    companyId: COMPANY,
    name,
    amountMode: 'FIXED',
    amount: 10_000,
    archivedAt: null,
    version: 1,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  }
}
