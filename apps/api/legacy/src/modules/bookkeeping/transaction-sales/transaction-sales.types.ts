/** `InvoiceClass`: `01` 세금계산서, `02` 수정세금계산서, `03` 계산서, `04` 수정계산서. */
export type InvoiceClassCode = '01' | '02' | '03' | '04'

/** `InvoiceKind`: `01` 일반, `02` 영세율, `03` 위수탁, `04` 영세율위수탁. */
export type InvoiceKindCode = '01' | '02' | '03' | '04'

/** `BuyerClass`: `01` 사업자번호, `02` 주민등록번호, `03` 외국인. */
export type BuyerClassCode = '01' | '02' | '03'

/** `ReceiptIssueClass`: `01` 영수, `02` 청구. */
export type PurposeCode = '01' | '02'

/** `ModifyReason` codes `01`–`06`, kept for a future amended-invoice flow. */
export type ModifyReasonCode = '01' | '02' | '03' | '04' | '05' | '06'

/** How an invoice was issued; only `normal` is supported. */
export type IssueInvoiceType = 'normal' | 'modify'

/** Lifecycle status of an issue attempt in `issued_invoices`. */
export type IssuedInvoiceStatus = 'issuing' | 'issued' | 'failed'

/** A party of a transaction statement as stored in the `supplier` and `buyer` JSON columns. */
export interface TransactionParty {
  business_number: string | null
  branch_number: string | null
  company_name: string | null
  representative_name: string | null
  address: string | null
  business_type: string | null
  business_class: string | null
  email: string | null
  email_sub?: string | null
  contact_name: string | null
  contact_part: string | null
  mobile_number: string | null
  phone_number: string | null
}

/** A row of `sales_transactions`. */
export interface SalesTransactionRow {
  id: string
  company_id: string
  partner_id: string | null
  class_code: InvoiceClassCode
  kind_code: InvoiceKindCode
  buyer_class_code: BuyerClassCode
  purpose: PurposeCode
  write_date: string
  description: string | null
  cash: number | null
  check_bill: number | null
  note: number | null
  crit: number | null
  supplier: string
  buyer: string
  grand_total_amount: number
  charge_total_amount: number
  tax_total_amount: number
  created_at: string
  updated_at: string
  deleted_at: string | null
}

/** A row of `sales_transaction_items`. */
export interface SalesTransactionItemRow {
  id: string
  transaction_id: string
  seq: number
  month: string
  day: string
  name: string
  specification: string | null
  quantity: string | null
  unit_price: number | null
  supply_amount: number
  tax_amount: number
  description: string | null
}

/** A row of `issued_invoices`. */
export interface IssuedInvoiceRow {
  id: string
  company_id: string
  transaction_id: string
  issue_type: IssueInvoiceType
  status: IssuedInvoiceStatus
  issue_no: string | null
  issue_datetime: string | null
  snapshot: string
  is_detail_synced: 0 | 1
  error_code: string | null
  error_message: string | null
  created_at: string
  updated_at: string
}

/** One item line in wire shape. */
export interface SalesTransactionItem {
  id: string
  month: string
  day: string
  name: string
  specification: string | null
  quantity: string | null
  unit_price: number | null
  supply_amount: number
  tax_amount: number
  description: string | null
}

/** Writable fields of a transaction statement, flattened as the client sends them. */
export interface SalesTransactionInput {
  partner_id: string | null
  class_code: InvoiceClassCode
  kind_code: InvoiceKindCode
  buyer_class_code: BuyerClassCode
  purpose: PurposeCode
  write_date: string
  description: string | null
  cash: number | null
  check_bill: number | null
  note: number | null
  crit: number | null
  supplier: TransactionParty
  buyer: TransactionParty
  items: Omit<SalesTransactionItem, 'id'>[]
  grand_total_amount: number
  charge_total_amount: number
  tax_total_amount: number
}

/** The statement fields frozen into an issued invoice, in wire shape. */
export type SalesTransactionSnapshot = Record<string, unknown> & { items: SalesTransactionItem[] }

/** What the Hometax adapter needs to issue an invoice. */
export interface InvoicePublishRequest {
  companyId: string
  transactionId: string
  /** Request time in ISO 8601, used as the issue time by the fake. */
  requestedAt: string
  snapshot: SalesTransactionSnapshot
}

/** Outcome of an issue request: an NTS approval number or a rejection. */
export type InvoicePublishResult =
  | { ok: true; issue_no: string; issue_datetime: string }
  | { ok: false; error_code: string; error_message: string }

/** Detail of an issued invoice as Hometax reports it. */
export interface InvoiceDetailResult {
  issue_no: string
  found: boolean
}

/** One 업태·종목 registration of a business. */
export interface BusinessTypeRecord {
  code: string
  business_type: string
  business_class: string
  is_main: boolean
}

/** Hometax e-tax invoice issuing and lookup, kept behind an interface so tests use a fake. */
export interface HometaxInvoiceAdapter {
  /** Issues an electronic tax invoice and waits for the NTS approval number. */
  publish(request: InvoicePublishRequest): Promise<InvoicePublishResult>
  /** Fetches the detail of an issued invoice by its approval number. */
  fetchDetail(companyId: string, issueNo: string): Promise<InvoiceDetailResult>
  /** Fetches the registered 업태·종목 of a business number without hyphens. */
  fetchBusinessTypes(businessNumber: string): Promise<BusinessTypeRecord[]>
}

/** Filters of the statement list and summaries. */
export interface SalesTransactionFilters {
  search?: string | undefined
  startDate?: string | undefined
  endDate?: string | undefined
  isIssued?: boolean | undefined
  issueInvoiceType?: IssueInvoiceType | undefined
  invoiceType?: InvoiceClassCode | undefined
}

/** A statement row with its count of successfully issued invoices. */
export interface SalesTransactionListRow extends SalesTransactionRow {
  invoice_count: number
}
