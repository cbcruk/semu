import type { Id } from '../../../shared/ids/ids.types.ts'

/** `InvoiceClass` 코드입니다. `01` 세금계산서, `02` 수정세금계산서, `03` 계산서, `04` 수정계산서. */
export type InvoiceClassCode = '01' | '02' | '03' | '04'

/** `InvoiceKind` 코드입니다. `01` 일반, `02` 영세율, `03` 위수탁, `04` 영세율위수탁. */
export type InvoiceKindCode = '01' | '02' | '03' | '04'

/** `BuyerClass` 코드입니다. `01` 사업자번호, `02` 주민등록번호, `03` 외국인. */
export type BuyerClassCode = '01' | '02' | '03'

/** `ReceiptIssueClass` 코드입니다. `01` 영수, `02` 청구. */
export type PurposeCode = '01' | '02'

/** 공급자·공급받는 자입니다. 발급 시점 스냅샷이라 거래처와 따로 둡니다. */
export interface TransactionParty {
  businessNumber: string | null
  branchNumber: string | null
  companyName: string | null
  representativeName: string | null
  address: string | null
  businessType: string | null
  businessItem: string | null
  email: string | null
  contactName: string | null
  contactDepartment: string | null
  mobileNumber: string | null
  phoneNumber: string | null
}

/** 거래명세서 품목 한 줄입니다. */
export interface StatementItem {
  /** `MM-DD`입니다. */
  monthDay: string
  name: string
  specification: string | null
  quantity: string | null
  unitPrice: number | null
  supplyAmount: number
  vatAmount: number
  description: string | null
}

/** 거래명세서의 결제 수단별 금액입니다. */
export interface PaymentBreakdown {
  cashAmount: number | null
  checkAmount: number | null
  noteAmount: number | null
  creditAmount: number | null
}

/** 저장한 거래명세서입니다. */
export interface SalesTransactionRecord {
  id: Id<'salesTransaction'>
  companyId: Id<'company'>
  partnerId: Id<'partner'> | null
  invoiceClassCode: InvoiceClassCode
  invoiceKindCode: InvoiceKindCode
  buyerClassCode: BuyerClassCode
  purposeCode: PurposeCode
  writeDate: string
  note: string | null
  payment: PaymentBreakdown
  supplier: TransactionParty
  buyer: TransactionParty
  buyerSecondaryEmail: string | null
  items: ReadonlyArray<StatementItem>
  supplyAmount: number
  vatAmount: number
  totalAmount: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  version: number
}

/** 세금계산서 발급 건의 상태입니다. */
export type TaxInvoiceStatus = 'ISSUING' | 'ISSUED' | 'FAILED'

/** 저장한 세금계산서 발급 건입니다. 발급 시점의 거래명세서를 고정해 둡니다. */
export interface TaxInvoiceRecord {
  id: Id<'taxInvoice'>
  companyId: Id<'company'>
  salesTransactionId: Id<'salesTransaction'>
  idempotencyKey: string
  status: TaxInvoiceStatus
  /** 국세청 승인번호입니다. */
  approvalNumber: string | null
  issuedAt: string | null
  detailSynced: boolean
  failure: { code: string; message: string } | null
  statement: SalesTransactionRecord
  createdAt: string
  updatedAt: string
}

/** 거래명세서를 받을 수 없는 이유입니다. */
export type StatementProblem =
  | { code: 'UNSUPPORTED'; field: 'invoiceKindCode' | 'invoiceClassCode' }
  | { code: 'AMOUNT_MISMATCH'; field: 'supplyAmount' | 'vatAmount' | 'totalAmount' }
