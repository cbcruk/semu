import { IdSchema } from '../../../shared/ids/id-schema.ts'

/** 증빙 ID입니다. 예: `evd_01J...` */
export const EvidenceId = IdSchema('evidence')

/** 계정과목 ID입니다. 예: `acc_01J...` */
export const AccountTitleId = IdSchema('accountTitle')

/** 거래처 ID입니다. 예: `ptn_01J...` */
export const PartnerId = IdSchema('partner')

/** 분류 규칙 ID입니다. 예: `rul_01J...` */
export const ClassificationRuleId = IdSchema('classificationRule')

/** 은행 계좌 ID입니다. 예: `bka_01J...` */
export const BankAccountId = IdSchema('bankAccount')

/** 입출금 거래 ID입니다. 예: `btx_01J...` */
export const BankTransactionId = IdSchema('bankTransaction')

/** 증빙 연결 ID입니다. 예: `stl_01J...` */
export const SettlementLinkId = IdSchema('settlementLink')

/** 거래명세서 ID입니다. 예: `stx_01J...` */
export const SalesTransactionId = IdSchema('salesTransaction')

/** 세금계산서 발급 건 ID입니다. 예: `ivc_01J...` */
export const TaxInvoiceId = IdSchema('taxInvoice')

/** 지로 고지서 ID입니다. 예: `gir_01J...` */
export const GiroId = IdSchema('giro')

/** 작업 ID입니다. 예: `job_01J...` */
export const JobId = IdSchema('job')
