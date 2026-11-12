import { describe, expect, it } from 'vitest'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { calculateWageRow } from '../engine/payroll-row.ts'
import { RATES_2026_03 } from '../engine/rate-tables-2026.ts'
import { MULTIPLIERS_FIVE_OR_MORE } from '../engine/working-time.ts'
import {
  catalogOf,
  deductionItemFieldsOf,
  defaultRowItems,
  engineDeductions,
  enginePaymentItems,
  paymentItemFieldsOf,
  rowItemViolations,
} from './payroll-item-rules.ts'
import { categoryPaymentItem, customPaymentItem, deductionItem } from './payroll-item.testing.ts'

describe('지급 항목 입력 규칙', () => {
  it('표준 항목을 불러오면 이름·비과세 유형·속성 기본값이 표준 항목에서 옵니다', () => {
    const result = paymentItemFieldsOf({ categoryCode: 'MEAL', defaultAmount: 200_000 }, undefined, [])

    expect(result).toEqual({
      ok: true,
      fields: {
        categoryCode: 'MEAL',
        name: '식대',
        nonTaxableCategory: 'MEAL',
        companyNonTaxableLimit: null,
        defaultAmount: 200_000,
        includeInOrdinaryWage: true,
        includeInMinimumWage: true,
        prorate: false,
      },
    })
  })

  it('표준 항목의 이름은 바꿀 수 없고 없는 표준 항목은 받지 않습니다', () => {
    expect(paymentItemFieldsOf({ categoryCode: 'MEAL', name: '점심값' }, undefined, [])).toEqual({
      ok: false,
      violations: [{ field: 'name', code: 'NAME_FIXED' }],
    })
    expect(paymentItemFieldsOf({ categoryCode: 'MEAL', name: ' 식대 ' }, undefined, []).ok).toBe(true)
    expect(paymentItemFieldsOf({ categoryCode: 'BONUS' }, undefined, [])).toEqual({
      ok: false,
      violations: [{ field: 'categoryCode', code: 'UNKNOWN_CATEGORY' }],
    })
  })

  it('직접 만든 항목은 과세이고 표준 항목 이름을 쓸 수 없습니다', () => {
    const custom = paymentItemFieldsOf({ name: ' 직책수당 ', includeInOrdinaryWage: true }, undefined, [])
    expect(custom).toMatchObject({
      ok: true,
      fields: { categoryCode: null, name: '직책수당', nonTaxableCategory: null, includeInOrdinaryWage: true },
    })

    expect(paymentItemFieldsOf({ name: '연차수당' }, undefined, [])).toEqual({
      ok: false,
      violations: [{ field: 'name', code: 'STANDARD_NAME_RESERVED' }],
    })
    expect(paymentItemFieldsOf({ name: '  ' }, undefined, [])).toEqual({
      ok: false,
      violations: [{ field: 'name', code: 'REQUIRED' }],
    })
  })

  it('엔진이 만드는 지급 줄 이름은 쓸 수 없고 만든 뒤 표준 항목은 바꿀 수 없습니다', () => {
    expect(paymentItemFieldsOf({ name: '연장근로수당' }, undefined, [])).toEqual({
      ok: false,
      violations: [{ field: 'name', code: 'RESERVED_NAME' }],
    })
    const position = customPaymentItem('직책수당')
    expect(paymentItemFieldsOf({ categoryCode: 'MEAL' }, position, [position])).toEqual({
      ok: false,
      violations: [{ field: 'categoryCode', code: 'CATEGORY_FIXED' }],
    })
    expect(paymentItemFieldsOf({ categoryCode: null, prorate: true }, position, [position]).ok).toBe(true)
  })

  it('보육수당은 일률성이 없어 통상임금에서 빼고 최저임금에는 넣습니다', () => {
    expect(paymentItemFieldsOf({ categoryCode: 'CHILDCARE' }, undefined, [])).toMatchObject({
      ok: true,
      fields: { includeInOrdinaryWage: false, includeInMinimumWage: true },
    })
  })

  it('회사 비과세 한도는 비과세 항목에만 둡니다', () => {
    expect(
      paymentItemFieldsOf({ categoryCode: 'RESEARCH', companyNonTaxableLimit: 100_000 }, undefined, []),
    ).toMatchObject({ ok: true, fields: { companyNonTaxableLimit: 100_000 } })
    expect(paymentItemFieldsOf({ name: '직책수당', companyNonTaxableLimit: 100_000 }, undefined, [])).toEqual({
      ok: false,
      violations: [{ field: 'companyNonTaxableLimit', code: 'NOT_APPLICABLE' }],
    })
  })

  it('지우지 않은 항목 사이에서 이름이 겹치면 안 되고, 자기 자신과 지운 항목은 보지 않습니다', () => {
    const meal = categoryPaymentItem('MEAL')
    const archived = customPaymentItem('직책수당', { archivedAt: '2026-02-01T00:00:00.000Z' })

    expect(paymentItemFieldsOf({ categoryCode: 'MEAL' }, undefined, [meal])).toEqual({
      ok: false,
      violations: [{ field: 'name', code: 'DUPLICATED' }],
    })
    expect(paymentItemFieldsOf({ prorate: true }, meal, [meal])).toMatchObject({ ok: true, fields: { prorate: true } })
    expect(paymentItemFieldsOf({ name: '직책수당' }, undefined, [archived]).ok).toBe(true)
  })

  it('고칠 때 빠진 값은 지금 값을 두고, null은 값을 지웁니다', () => {
    const meal = categoryPaymentItem('MEAL', { defaultAmount: 200_000, companyNonTaxableLimit: 150_000 })

    expect(paymentItemFieldsOf({ defaultAmount: null }, meal, [meal])).toMatchObject({
      ok: true,
      fields: { defaultAmount: null, companyNonTaxableLimit: 150_000, includeInOrdinaryWage: true },
    })
  })
})

describe('공제 항목 입력 규칙', () => {
  it('고정 공제는 금액이 있어야 하고 정산 시 입력은 금액이 없습니다', () => {
    expect(deductionItemFieldsOf({ name: '동호회비', amount: 10_000 }, undefined, [])).toEqual({
      ok: true,
      fields: { name: '동호회비', amountMode: 'FIXED', amount: 10_000 },
    })
    expect(deductionItemFieldsOf({ name: '동호회비' }, undefined, [])).toEqual({
      ok: false,
      violations: [{ field: 'amount', code: 'REQUIRED' }],
    })
    expect(
      deductionItemFieldsOf({ name: '가불금', amountMode: 'ON_SETTLEMENT', amount: 5_000 }, undefined, []),
    ).toEqual({ ok: false, violations: [{ field: 'amount', code: 'NOT_APPLICABLE' }] })
  })

  it('정산 시 입력으로 바꾸면 금액을 지우고, 고정으로 되돌리면 금액을 다시 받아야 합니다', () => {
    const club = deductionItem('동호회비')
    const onSettlement = deductionItemFieldsOf({ amountMode: 'ON_SETTLEMENT' }, club, [club])
    expect(onSettlement).toEqual({ ok: true, fields: { name: '동호회비', amountMode: 'ON_SETTLEMENT', amount: null } })

    const settled = deductionItem('동호회비', { amountMode: 'ON_SETTLEMENT', amount: null })
    expect(deductionItemFieldsOf({ amountMode: 'FIXED' }, settled, [settled])).toEqual({
      ok: false,
      violations: [{ field: 'amount', code: 'REQUIRED' }],
    })
  })

  it('엔진이 만드는 공제 줄 이름과 겹치는 이름은 받지 않습니다', () => {
    expect(deductionItemFieldsOf({ name: '국민연금', amount: 1 }, undefined, [])).toEqual({
      ok: false,
      violations: [{ field: 'name', code: 'RESERVED_NAME' }],
    })
    expect(deductionItemFieldsOf({ name: ' ', amount: 1 }, undefined, [])).toEqual({
      ok: false,
      violations: [{ field: 'name', code: 'REQUIRED' }],
    })
  })
})

describe('행이 가리키는 항목', () => {
  const meal = categoryPaymentItem('MEAL')
  const oldBonus = customPaymentItem('직책수당', {
    id: 'pit_old' as Id<'paymentItem'>,
    archivedAt: '2026-02-01T00:00:00.000Z',
  })
  const club = deductionItem('동호회비')
  const catalog = catalogOf([meal, oldBonus], [club])

  it('카탈로그에 없는 항목, 지운 항목, 한 행에 두 번 넣은 항목을 찾습니다', () => {
    const violations = rowItemViolations(
      {
        paymentItems: [
          { itemId: meal.id, amount: 1 },
          { itemId: 'pit_missing', amount: 1 },
          { itemId: oldBonus.id, amount: 1 },
          { itemId: meal.id, amount: 1 },
        ],
        otherDeductions: [{ itemId: 'dit_missing', amount: 1 }],
      },
      undefined,
      catalog,
    )

    expect(violations).toEqual([
      { field: 'input.paymentItems[1].itemId', code: 'NOT_FOUND' },
      { field: 'input.paymentItems[2].itemId', code: 'ARCHIVED' },
      { field: 'input.paymentItems[3].itemId', code: 'DUPLICATED' },
      { field: 'input.otherDeductions[0].itemId', code: 'NOT_FOUND' },
    ])
  })

  it('고치기 전 행에 없던 지운 항목만 거절합니다', () => {
    const gone = customPaymentItem('지운수당', {
      id: 'pit_gone' as Id<'paymentItem'>,
      archivedAt: '2026-02-01T00:00:00.000Z',
    })
    const both = catalogOf([oldBonus, gone], [])

    expect(
      rowItemViolations(
        {
          paymentItems: [
            { itemId: oldBonus.id, amount: 1 },
            { itemId: gone.id, amount: 1 },
          ],
        },
        { paymentItems: [{ itemId: oldBonus.id, amount: 1 }] },
        both,
      ),
    ).toEqual([{ field: 'input.paymentItems[1].itemId', code: 'ARCHIVED' }])
  })

  it('고치기 전 행에 있던 지운 항목은 그대로 둘 수 있습니다', () => {
    const before = { paymentItems: [{ itemId: oldBonus.id, amount: 100_000 }] }

    expect(rowItemViolations({ paymentItems: [{ itemId: oldBonus.id, amount: 120_000 }] }, before, catalog)).toEqual([])
  })

  it('지급 항목을 계산하는 때의 카탈로그 속성으로 풀고 줄의 코드는 항목 ID입니다', () => {
    const limited = categoryPaymentItem('RESEARCH', { companyNonTaxableLimit: 100_000, prorate: true })

    expect(enginePaymentItems([{ itemId: limited.id, amount: 300_000 }], catalogOf([limited], []))).toEqual([
      {
        code: limited.id,
        name: '연구보조비',
        amount: 300_000,
        nonTaxableCategory: 'RESEARCH',
        companyNonTaxableLimit: 100_000,
        includeInOrdinaryWage: true,
        includeInMinimumWage: true,
        prorate: true,
      },
    ])
    expect(engineDeductions([{ itemId: club.id, amount: 10_000 }], catalog)).toEqual([
      { code: club.id, name: '동호회비', amount: 10_000 },
    ])
  })

  it('통상임금에 넣은 항목은 연장근로수당 단가를 올립니다', () => {
    const position = customPaymentItem('직책수당', { includeInOrdinaryWage: true })
    const overtimePay = (includeInOrdinaryWage: boolean) =>
      calculateWageRow(
        {
          incomeType: 'WAGE_MONTHLY',
          attributionMonth: '2026-03',
          basePay: 2_090_000,
          paymentItems: enginePaymentItems(
            [{ itemId: position.id, amount: 209_000 }],
            catalogOf([{ ...position, includeInOrdinaryWage }], []),
          ),
          work: { overtimeMinutes: 60 },
          multipliers: MULTIPLIERS_FIVE_OR_MORE,
          monthlyStandardHours: 209,
          insurance: {
            nationalPension: { mode: 'EXEMPT' },
            healthInsurance: { mode: 'EXEMPT' },
            employmentInsurance: { mode: 'EXEMPT' },
          },
          incomeTax: { method: 'NONE', dependants: 1, childrenAged8To20: 0, withholdingRatePpm: 1_000_000 },
        },
        RATES_2026_03,
      ).payments.find((line) => line.code === 'OVERTIME_PAY')?.amount

    // (2,090,000 + 209,000) ÷ 209 = 11,000원 × 1.5 = 16,500원, 넣지 않으면 10,000원 × 1.5 = 15,000원
    expect(overtimePay(true)).toBe(16_500)
    expect(overtimePay(false)).toBe(15_000)
  })

  it('정기 대장의 근로 행에는 기본 금액이 있는 지급 항목과 고정 공제만 만든 순서로 넣습니다', () => {
    const later = customPaymentItem('직책수당', {
      id: 'pit_later' as Id<'paymentItem'>,
      defaultAmount: 100_000,
      createdAt: '2026-01-02T00:00:00.000Z',
    })
    const mealWithAmount = categoryPaymentItem('MEAL', { defaultAmount: 200_000 })
    const archivedWithAmount = customPaymentItem('지운수당', {
      id: 'pit_gone' as Id<'paymentItem'>,
      defaultAmount: 1,
      archivedAt: '2026-02-01T00:00:00.000Z',
    })
    const settled = deductionItem('가불금', {
      id: 'dit_settled' as Id<'deductionItem'>,
      amountMode: 'ON_SETTLEMENT',
      amount: null,
    })

    expect(
      defaultRowItems(
        catalogOf([later, mealWithAmount, archivedWithAmount, categoryPaymentItem('VEHICLE')], [club, settled]),
      ),
    ).toEqual({
      paymentItems: [
        { itemId: mealWithAmount.id, amount: 200_000 },
        { itemId: later.id, amount: 100_000 },
      ],
      otherDeductions: [{ itemId: club.id, amount: 10_000 }],
    })
  })
})
