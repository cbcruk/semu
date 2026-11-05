import { Schema } from 'effect'
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from 'effect/http-api'
import { Page, PageQueryFields } from '../../../shared/http/pagination.ts'
import { PermissionDenied, VersionMismatch } from '../../../shared/problem/problem.ts'
import { Authentication } from '../../identity-access/authentication.ts'
import { AccountTitleNotAssignable } from '../account-titles/account-title.ts'
import { AccountTitleId, BankAccountId, BankTransactionId, EvidenceId, PartnerId } from '../common/ids.ts'
import { CalendarDate, IfMatchHeaders, Memo, Won } from '../common/wire.ts'
import { BatchTargetMissing, ClassificationStatus, PartnerNotFound } from '../evidence/evidence.ts'
import {
  BalanceSnapshot,
  BankAccount,
  BankAccountNotFound,
  BankAccountSummary,
  BankTransaction,
  BankTransactionNotFound,
  Direction,
  SettlementLinkInvalid,
} from './bank.ts'

const accountParams = { bankAccountId: BankAccountId }
const transactionParams = { bankTransactionId: BankTransactionId }
const transactionSuccess = HttpApiSchema.WithHeaders(BankTransaction, { etag: Schema.String })

/** 수집한 은행 계좌입니다. 계좌는 연동으로만 생기고 사람은 별칭과 자금 현황 포함 여부만 바꿉니다. */
export class BankAccountsApi extends HttpApiGroup.make('bankAccounts')
  .add(
    HttpApiEndpoint.get('list', '/bank-accounts', {
      success: Schema.Struct({ items: Schema.Array(BankAccount) }),
      error: PermissionDenied,
    }),
    HttpApiEndpoint.get('summary', '/bank-accounts::summary', {
      success: BankAccountSummary,
      error: PermissionDenied,
    }),
    HttpApiEndpoint.patch('update', '/bank-accounts/:bankAccountId', {
      params: accountParams,
      headers: IfMatchHeaders,
      payload: Schema.Struct({
        alias: Schema.optionalKey(Schema.NullOr(Schema.String.check(Schema.isMaxLength(30)))),
        cashReport: Schema.optionalKey(Schema.Literals(['INCLUDED', 'EXCLUDED'])),
      }),
      success: HttpApiSchema.WithHeaders(BankAccount, { etag: Schema.String }),
      error: [BankAccountNotFound, VersionMismatch, PermissionDenied],
    }),
    HttpApiEndpoint.get('balances', '/bank-accounts/:bankAccountId/balances', {
      params: accountParams,
      query: Schema.Struct({ from: CalendarDate, to: CalendarDate }),
      success: Schema.Struct({ openingBalance: Won, items: Schema.Array(BalanceSnapshot) }),
      error: [BankAccountNotFound, PermissionDenied],
    }),
  )
  .middleware(Authentication) {}

/**
 * 입출금 거래입니다. 분류·거래처·메모를 바꾸고, 거래대금으로 분류한 거래는 증빙에 연결(`:link`)합니다.
 *
 * 연결 상태(`settlement.status`)는 저장하지 않고 응답할 때 계산합니다.
 */
export class BankTransactionsApi extends HttpApiGroup.make('bankTransactions')
  .add(
    HttpApiEndpoint.get('list', '/bank-transactions', {
      query: Schema.Struct({
        ...PageQueryFields,
        bankAccountId: Schema.optionalKey(BankAccountId),
        from: Schema.optionalKey(CalendarDate),
        to: Schema.optionalKey(CalendarDate),
        direction: Schema.optionalKey(Direction),
        classification: Schema.optionalKey(ClassificationStatus),
        settlement: Schema.optionalKey(Schema.Literals(['PARTNER_REQUIRED', 'UNMATCHED', 'MATCHED', 'NOT_APPLICABLE'])),
        search: Schema.optionalKey(Schema.String),
      }),
      success: Page(BankTransaction),
      error: PermissionDenied,
    }),
    HttpApiEndpoint.get('get', '/bank-transactions/:bankTransactionId', {
      params: transactionParams,
      success: transactionSuccess,
      error: [BankTransactionNotFound, PermissionDenied],
    }),
    HttpApiEndpoint.patch('update', '/bank-transactions/:bankTransactionId', {
      params: transactionParams,
      headers: IfMatchHeaders,
      payload: Schema.Struct({
        memo: Schema.optionalKey(Schema.NullOr(Memo)),
        partnerId: Schema.optionalKey(Schema.NullOr(PartnerId)),
      }),
      success: transactionSuccess,
      error: [BankTransactionNotFound, PartnerNotFound, VersionMismatch, PermissionDenied],
    }),
    HttpApiEndpoint.post('classify', '/bank-transactions/:bankTransactionId::classify', {
      params: transactionParams,
      headers: IfMatchHeaders,
      payload: Schema.Struct({
        accountTitleId: Schema.NullOr(AccountTitleId),
        partnerId: Schema.optionalKey(Schema.NullOr(PartnerId)),
      }),
      success: transactionSuccess,
      error: [BankTransactionNotFound, AccountTitleNotAssignable, PartnerNotFound, VersionMismatch, PermissionDenied],
    }),
    HttpApiEndpoint.post('batchClassify', '/bank-transactions::batchClassify', {
      payload: Schema.Struct({
        bankTransactionIds: Schema.Array(BankTransactionId).check(Schema.isMinLength(1), Schema.isMaxLength(500)),
        accountTitleId: Schema.NullOr(AccountTitleId),
      }),
      success: Schema.Struct({ updatedCount: Schema.Int }),
      error: [BatchTargetMissing, AccountTitleNotAssignable, PermissionDenied],
    }),
    HttpApiEndpoint.post('link', '/bank-transactions/:bankTransactionId::link', {
      params: transactionParams,
      headers: IfMatchHeaders,
      payload: Schema.Struct({
        /** 이 거래의 연결 전체입니다. 빈 목록이면 모두 끊습니다. */
        links: Schema.Array(Schema.Struct({ evidenceId: EvidenceId, amount: Won })),
      }),
      success: transactionSuccess,
      error: [BankTransactionNotFound, SettlementLinkInvalid, VersionMismatch, PermissionDenied],
    }),
  )
  .middleware(Authentication) {}
