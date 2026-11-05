import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { Page, PageQueryFields } from '../../../shared/http/pagination.ts'
import { IdempotencyKeyRequired, PermissionDenied, VersionMismatch } from '../../../shared/problem/problem.ts'
import { Authentication } from '../../identity-access/authentication.ts'
import { SalesTransactionId, TaxInvoiceId } from '../common/ids.ts'
import { CalendarDate, IdempotencyHeaders, IfMatchHeaders } from '../common/wire.ts'
import { PartnerNotFound } from '../evidence/evidence.ts'
import {
  IdempotencyKeyReused,
  SalesStatementInvalid,
  SalesTransaction,
  SalesTransactionLocked,
  SalesTransactionNotFound,
  StatementFields,
  TaxInvoice,
  TaxInvoiceNotFound,
  TaxInvoiceRejected,
  TransactionPartyInput,
} from './sales-transaction.ts'

const StatementPayload = {
  ...StatementFields,
  supplier: TransactionPartyInput,
  buyer: TransactionPartyInput,
}

const params = { salesTransactionId: SalesTransactionId }
const success = HttpApiSchema.WithHeaders(SalesTransaction, { etag: Schema.String })

/** 거래명세서입니다. 세금계산서를 발급하기 전까지만 고치거나 지울 수 있습니다. */
export class SalesTransactionsApi extends HttpApiGroup.make('salesTransactions')
  .add(
    HttpApiEndpoint.get('list', '/sales-transactions', {
      query: Schema.Struct({
        ...PageQueryFields,
        from: Schema.optionalKey(CalendarDate),
        to: Schema.optionalKey(CalendarDate),
        issueStatus: Schema.optionalKey(Schema.Literals(['ISSUE_REQUIRED', 'ISSUED'])),
      }),
      success: Page(SalesTransaction),
      error: PermissionDenied,
    }),
    HttpApiEndpoint.post('create', '/sales-transactions', {
      payload: Schema.Struct(StatementPayload),
      success: SalesTransaction.pipe(HttpApiSchema.status(201)),
      error: [SalesStatementInvalid, PartnerNotFound, PermissionDenied],
    }),
    HttpApiEndpoint.get('get', '/sales-transactions/:salesTransactionId', {
      params,
      success,
      error: [SalesTransactionNotFound, PermissionDenied],
    }),
    HttpApiEndpoint.patch('update', '/sales-transactions/:salesTransactionId', {
      params,
      headers: IfMatchHeaders,
      payload: Schema.Struct(
        Object.fromEntries(
          Object.entries(StatementPayload).map(([key, schema]) => [key, Schema.optionalKey(schema)]),
        ) as { [K in keyof typeof StatementPayload]: Schema.optionalKey<(typeof StatementPayload)[K]> },
      ),
      success,
      error: [
        SalesTransactionNotFound,
        SalesStatementInvalid,
        SalesTransactionLocked,
        PartnerNotFound,
        VersionMismatch,
        PermissionDenied,
      ],
    }),
    HttpApiEndpoint.delete('remove', '/sales-transactions/:salesTransactionId', {
      params,
      success: HttpApiSchema.NoContent,
      error: [SalesTransactionNotFound, SalesTransactionLocked, PermissionDenied],
    }),
  )
  .middleware(Authentication) {}

/**
 * 세금계산서 발급 건입니다. `POST /tax-invoices`가 홈택스에 발급을 요청합니다.
 *
 * 외부 효과가 있어 `Idempotency-Key`가 필수이고, 같은 키의 재시도는 처음 결과를 돌려줍니다.
 */
export class TaxInvoicesApi extends HttpApiGroup.make('taxInvoices')
  .add(
    HttpApiEndpoint.post('issue', '/tax-invoices', {
      headers: IdempotencyHeaders,
      payload: Schema.Struct({ salesTransactionId: SalesTransactionId }),
      success: TaxInvoice.pipe(HttpApiSchema.status(201)),
      error: [
        IdempotencyKeyRequired,
        IdempotencyKeyReused,
        SalesTransactionNotFound,
        SalesStatementInvalid,
        SalesTransactionLocked,
        TaxInvoiceRejected,
        PermissionDenied,
      ],
    }),
    HttpApiEndpoint.get('list', '/tax-invoices', {
      query: Schema.Struct({ salesTransactionId: Schema.optionalKey(SalesTransactionId) }),
      success: Schema.Struct({ items: Schema.Array(TaxInvoice) }),
      error: PermissionDenied,
    }),
    HttpApiEndpoint.get('get', '/tax-invoices/:taxInvoiceId', {
      params: { taxInvoiceId: TaxInvoiceId },
      success: TaxInvoice,
      error: [TaxInvoiceNotFound, PermissionDenied],
    }),
    HttpApiEndpoint.post('sync', '/tax-invoices/:taxInvoiceId::sync', {
      params: { taxInvoiceId: TaxInvoiceId },
      success: TaxInvoice,
      error: [TaxInvoiceNotFound, PermissionDenied],
    }),
  )
  .middleware(Authentication) {}
