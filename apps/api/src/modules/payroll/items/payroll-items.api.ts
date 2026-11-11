import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { IdSchema } from '../../../shared/ids/id-schema.ts'
import { VersionMismatch } from '../../../shared/problem/problem.ts'
import { Authentication } from '../../identity-access/authentication.ts'
import { ACCESS_ERRORS, PayrollItemArchived, PayrollItemInvalid, PayrollItemNotFound } from '../payroll-problems.ts'
import {
  CreateDeductionItem,
  CreatePaymentItem,
  DeductionItem,
  ItemListQuery,
  PaymentItem,
  PaymentItemCategorySchema,
  UpdateDeductionItem,
  UpdatePaymentItem,
} from './payroll-item.ts'

const ifMatch = { 'if-match': Schema.optionalKey(Schema.String) }
const paymentParams = { itemId: IdSchema('paymentItem') }
const deductionParams = { itemId: IdSchema('deductionItem') }
const PaymentWithEtag = HttpApiSchema.WithHeaders(PaymentItem, { etag: Schema.String })
const DeductionWithEtag = HttpApiSchema.WithHeaders(DeductionItem, { etag: Schema.String })

/**
 * 회사의 지급 항목 카탈로그입니다. 표준 항목을 불러오거나 과세 항목을 직접 만들고, 급여대장 행이 `itemId`로 가리킵니다.
 * 비과세 유형·한도, 통상임금·최저임금 산입, 일할계산은 항목에 두고 행을 계산할 때 읽습니다.
 */
export class PaymentItemsGroup extends HttpApiGroup.make('payroll-payment-items')
  .add(
    HttpApiEndpoint.get('categories', '/payroll-payment-categories', {
      success: Schema.Struct({ items: Schema.Array(PaymentItemCategorySchema) }),
      error: ACCESS_ERRORS,
    }),
  )
  .add(
    HttpApiEndpoint.get('list', '/payroll-payment-items', {
      query: ItemListQuery,
      success: Schema.Struct({ items: Schema.Array(PaymentItem) }),
      error: ACCESS_ERRORS,
    }),
  )
  .add(
    HttpApiEndpoint.post('create', '/payroll-payment-items', {
      payload: CreatePaymentItem,
      success: PaymentWithEtag.pipe(HttpApiSchema.status(201)),
      error: [...ACCESS_ERRORS, PayrollItemInvalid],
    }),
  )
  .add(
    HttpApiEndpoint.get('get', '/payroll-payment-items/:itemId', {
      params: paymentParams,
      success: PaymentWithEtag,
      error: [...ACCESS_ERRORS, PayrollItemNotFound],
    }),
  )
  .add(
    HttpApiEndpoint.patch('update', '/payroll-payment-items/:itemId', {
      params: paymentParams,
      headers: ifMatch,
      payload: UpdatePaymentItem,
      success: PaymentWithEtag,
      error: [...ACCESS_ERRORS, PayrollItemNotFound, PayrollItemArchived, PayrollItemInvalid, VersionMismatch],
    }),
  )
  .add(
    HttpApiEndpoint.delete('delete', '/payroll-payment-items/:itemId', {
      params: paymentParams,
      success: HttpApiSchema.NoContent,
      error: [...ACCESS_ERRORS, PayrollItemNotFound],
    }),
  )
  .middleware(Authentication) {}

/** 회사의 공제 항목 카탈로그입니다. 4대보험·세금 밖의 공제(선지급금, 동호회비 등)이고, 급여대장 행이 `itemId`로 가리킵니다. */
export class DeductionItemsGroup extends HttpApiGroup.make('payroll-deduction-items')
  .add(
    HttpApiEndpoint.get('list', '/payroll-deduction-items', {
      query: ItemListQuery,
      success: Schema.Struct({ items: Schema.Array(DeductionItem) }),
      error: ACCESS_ERRORS,
    }),
  )
  .add(
    HttpApiEndpoint.post('create', '/payroll-deduction-items', {
      payload: CreateDeductionItem,
      success: DeductionWithEtag.pipe(HttpApiSchema.status(201)),
      error: [...ACCESS_ERRORS, PayrollItemInvalid],
    }),
  )
  .add(
    HttpApiEndpoint.get('get', '/payroll-deduction-items/:itemId', {
      params: deductionParams,
      success: DeductionWithEtag,
      error: [...ACCESS_ERRORS, PayrollItemNotFound],
    }),
  )
  .add(
    HttpApiEndpoint.patch('update', '/payroll-deduction-items/:itemId', {
      params: deductionParams,
      headers: ifMatch,
      payload: UpdateDeductionItem,
      success: DeductionWithEtag,
      error: [...ACCESS_ERRORS, PayrollItemNotFound, PayrollItemArchived, PayrollItemInvalid, VersionMismatch],
    }),
  )
  .add(
    HttpApiEndpoint.delete('delete', '/payroll-deduction-items/:itemId', {
      params: deductionParams,
      success: HttpApiSchema.NoContent,
      error: [...ACCESS_ERRORS, PayrollItemNotFound],
    }),
  )
  .middleware(Authentication) {}
