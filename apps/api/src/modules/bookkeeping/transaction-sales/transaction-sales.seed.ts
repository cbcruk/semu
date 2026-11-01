import type { DatabaseSync } from 'node:sqlite'
import type { SeedContext } from '../../../db/seed.types'
import { findTransaction, insertIssuingInvoice, insertTransaction, listItems, markInvoiceIssued } from './transaction-sales.repository'
import type { SalesTransactionInput, TransactionParty } from './transaction-sales.types'
import { toItem, toSnapshot } from './transaction-sales.utils'

const COMPANY = 'c-corp'

/** Inserts demo transaction statements for `c-corp`: one draft and one issued with its invoice. */
export function seedTransactionSalesDemo(db: DatabaseSync, context: SeedContext): void {
  const supplier = party('1108100001', '주식회사 데모', '김데모')
  insertTransaction(db, COMPANY, 'st-draft', statement(supplier, party('2208112345', '주식회사 에코상사', '이에코'), '2026-10-28', '컨설팅 용역', 2_000_000), context.now)
  insertTransaction(db, COMPANY, 'st-issued', statement(supplier, party('3308154321', '주식회사 한빛', '박한빛'), '2026-10-15', '소프트웨어 유지보수', 5_000_000), context.now)
  const issued = findTransaction(db, COMPANY, 'st-issued')
  if (issued === undefined) return
  const snapshot = JSON.stringify(toSnapshot(issued, listItems(db, issued.id).map(toItem)))
  insertIssuingInvoice(db, COMPANY, issued.id, 'ii-demo', snapshot, context.now)
  markInvoiceIssued(db, 'ii-demo', '20261015-41000000-12345678', '2026-10-15T10:00:00+09:00', context.now)
}

function party(businessNumber: string, companyName: string, representativeName: string): TransactionParty {
  return {
    business_number: businessNumber,
    branch_number: null,
    company_name: companyName,
    representative_name: representativeName,
    address: null,
    business_type: null,
    business_class: null,
    email: null,
    contact_name: null,
    contact_part: null,
    mobile_number: null,
    phone_number: null,
  }
}

function statement(supplier: TransactionParty, buyer: TransactionParty, writeDate: string, itemName: string, supply: number): SalesTransactionInput {
  const tax = supply / 10
  return {
    partner_id: null,
    class_code: '01',
    kind_code: '01',
    buyer_class_code: '01',
    purpose: '02',
    write_date: writeDate,
    description: null,
    cash: null,
    check_bill: null,
    note: null,
    crit: supply + tax,
    supplier,
    buyer,
    items: [
      {
        month: writeDate.slice(5, 7),
        day: writeDate.slice(8, 10),
        name: itemName,
        specification: null,
        quantity: '1',
        unit_price: supply,
        supply_amount: supply,
        tax_amount: tax,
        description: null,
      },
    ],
    grand_total_amount: supply + tax,
    charge_total_amount: supply,
    tax_total_amount: tax,
  }
}
