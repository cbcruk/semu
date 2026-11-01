import type {
  BuyerClassCode,
  InvoiceClassCode,
  InvoiceKindCode,
  IssuedInvoiceRow,
  ModifyReasonCode,
  PurposeCode,
  SalesTransactionItem,
  SalesTransactionItemRow,
  SalesTransactionRow,
  SalesTransactionSnapshot,
  TransactionParty,
} from './transaction-sales.types'

/** `InvoiceClass` codes with their Korean labels. */
export const INVOICE_CLASS = { '01': '세금계산서', '02': '수정세금계산서', '03': '계산서', '04': '수정계산서' } as const satisfies Record<
  InvoiceClassCode,
  string
>

/** `InvoiceKind` codes with their Korean labels. */
export const INVOICE_KIND = { '01': '일반', '02': '영세율', '03': '위수탁', '04': '영세율위수탁' } as const satisfies Record<InvoiceKindCode, string>

/** `BuyerClass` codes with their Korean labels. */
export const BUYER_CLASS = { '01': '사업자번호', '02': '주민등록번호', '03': '외국인' } as const satisfies Record<BuyerClassCode, string>

/** `ReceiptIssueClass` codes with their Korean labels. */
export const RECEIPT_ISSUE_CLASS = { '01': '영수', '02': '청구' } as const satisfies Record<PurposeCode, string>

/** `ModifyReason` codes with their Korean labels; unused until amended invoices are supported. */
export const MODIFY_REASON = {
  '01': '기재사항 착오정정',
  '02': '공급가액 변동',
  '03': '환입',
  '04': '계약 해제',
  '05': '내국신용장 사후개설',
  '06': '착오에 의한 이중발급',
} as const satisfies Record<ModifyReasonCode, string>

/** Party fields in the order they are flattened onto the wire as `supplier_*` and `buyer_*`. */
export const PARTY_FIELDS = [
  'business_number',
  'branch_number',
  'company_name',
  'representative_name',
  'address',
  'business_type',
  'business_class',
  'email',
  'contact_name',
  'contact_part',
  'mobile_number',
  'phone_number',
] as const

/** Summarises item names as `첫 품목 외 N건`. */
export function itemSummary(items: readonly { name: string }[]): string {
  const first = items[0]?.name ?? ''
  return items.length > 1 ? `${first} 외 ${items.length - 1}건` : first
}

/** Converts an item row to wire shape. */
export function toItem(row: SalesTransactionItemRow): SalesTransactionItem {
  return {
    id: row.id,
    month: row.month,
    day: row.day,
    name: row.name,
    specification: row.specification,
    quantity: row.quantity,
    unit_price: row.unit_price,
    supply_amount: row.supply_amount,
    tax_amount: row.tax_amount,
    description: row.description,
  }
}

/** Builds the flat statement body shared by statement responses and invoice snapshots. */
export function toSnapshot(row: SalesTransactionRow, items: readonly SalesTransactionItem[]): SalesTransactionSnapshot {
  const supplier = JSON.parse(row.supplier) as TransactionParty
  const buyer = JSON.parse(row.buyer) as TransactionParty
  const flat: Record<string, unknown> = {}
  for (const field of PARTY_FIELDS) {
    flat[`supplier_${field}`] = supplier[field] ?? null
    flat[`buyer_${field}`] = buyer[field] ?? null
  }
  flat['buyer_email_sub'] = buyer.email_sub ?? null
  return {
    id: row.id,
    company: row.company_id,
    created: row.created_at,
    modified: row.updated_at,
    partner_id: row.partner_id,
    class_code: row.class_code,
    kind_code: row.kind_code,
    buyer_class_code: row.buyer_class_code,
    write_date: row.write_date,
    description: row.description,
    cash: row.cash,
    check_bill: row.check_bill,
    note: row.note,
    crit: row.crit,
    purpose: row.purpose,
    grand_total_amount: row.grand_total_amount,
    charge_total_amount: row.charge_total_amount,
    tax_total_amount: row.tax_total_amount,
    ...flat,
    items: [...items],
  }
}

/** Converts an issue attempt to the `IssuedInvoice` wire shape: the frozen statement plus issue fields. */
export function toIssuedInvoice(row: IssuedInvoiceRow): Record<string, unknown> {
  const snapshot = JSON.parse(row.snapshot) as SalesTransactionSnapshot
  return {
    ...snapshot,
    id: row.id,
    transaction_id: row.transaction_id,
    issue_type: row.issue_type,
    status: row.status,
    issue_no: row.issue_no,
    issue_datetime: row.issue_datetime,
    is_detail_synced: row.is_detail_synced === 1,
    error_code: row.error_code,
    error_message: row.error_message,
    created: row.created_at,
    modified: row.updated_at,
  }
}
