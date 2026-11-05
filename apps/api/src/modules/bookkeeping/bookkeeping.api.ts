import { HttpApi } from 'effect/http-api'
import { AccountTitlesApi } from './account-titles/account-titles.api.ts'
import { BankAccountsApi, BankTransactionsApi } from './bank/bank.api.ts'
import { PartnersApi } from './partners/partners.api.ts'
import { GirosApi } from './giros/giros.api.ts'
import { ReportsApi } from './reports/reports.api.ts'
import { SalesTransactionsApi, TaxInvoicesApi } from './sales-transactions/sales-transactions.api.ts'
import { ClassificationRulesApi } from './classification/classification-rules.api.ts'
import { EvidenceApi } from './evidence/evidence.api.ts'

/**
 * 증빙·계정과목·자동분류·입출금·거래처·세금계산서·지로·결산 보고서 컨텍스트의 HTTP 계약입니다. 루트 `Api`가 `addHttpApi`로 합칩니다.
 *
 * 모든 그룹은 인증이 필요하고(`.middleware(Authentication)`), 회사는 행위자에서 정합니다.
 */
export const BookkeepingApi = HttpApi.make('bookkeeping')
  .add(EvidenceApi)
  .add(AccountTitlesApi)
  .add(ClassificationRulesApi)
  .add(BankAccountsApi)
  .add(BankTransactionsApi)
  .add(PartnersApi)
  .add(SalesTransactionsApi)
  .add(TaxInvoicesApi)
  .add(GirosApi)
  .add(ReportsApi)
