import type { DatabaseSync } from 'node:sqlite'
import { execute } from '../../../db/query'
import type { SeedContext } from '../../../db/seed.types'
import { insertGiro, insertGiroAction } from './giros.repository'
import type { GiroDoneReason, GiroStatus, ScrapedGiroBill } from './giros.types'

const COMPANY = 'c-corp'

/** Inserts demo giro bills for `c-corp` in every visible status and subscribes `u-admin` to payment reminders. */
export function seedGiroDemo(db: DatabaseSync, context: SeedContext): void {
  const bills: [string, ScrapedGiroBill, GiroStatus, GiroDoneReason | null][] = [
    ['giro-vat', nationalTax('0126110300000000001', '부가가치세', 1_200_000, '2026-11-03'), 'todo', null],
    ['giro-local', localTax('2611260000000000002', '주민세(사업소분)', 62_500, '2026-11-30'), 'todo', null],
    ['giro-unknown', nationalTax('0126093000000000003', '원천세', 340_000, '2026-09-30'), 'unknown', null],
    ['giro-done', nationalTax('0126081000000000004', '원천세', 310_000, '2026-08-10'), 'done', 'manual'],
  ]
  for (const [id, bill, status, doneReason] of bills) {
    insertGiro(db, COMPANY, id, bill, status, doneReason, context.now)
    insertGiroAction(db, id, 'created', '', 'system', context.now)
    if (status === 'done') insertGiroAction(db, id, 'manual_done', '', 'u-admin@example.com', context.now)
  }
  execute(db, "INSERT INTO notification_subscriptions (company_id, user_id, kind, enabled, updated_at) VALUES (?, 'u-admin', 'tax_payment_due', 1, ?)", [
    COMPANY,
    context.now,
  ])
}

function nationalTax(ePayNo: string, taxName: string, amount: number, dueDate: string): ScrapedGiroBill {
  return {
    e_pay_no: ePayNo,
    giro_type: '국세',
    slip_type: '국세고지내역조회_사업자번호',
    tax_name: taxName,
    bill_org_name: '역삼세무서',
    pay_amount: amount,
    due_date: dueDate,
    detail: {
      bill_org_name: '역삼세무서',
      e_pay_no: ePayNo,
      biz_no: '1108100001',
      pay_amount: amount,
      pay_amount1: amount,
      pay_amount2: Math.floor(amount * 1.03),
      pay_date1: dueDate,
      pay_date2: dueDate,
      payer_name: '주식회사 데모',
      tax_name: taxName,
    },
  }
}

function localTax(ePayNo: string, taxName: string, amount: number, dueDate: string): ScrapedGiroBill {
  return {
    e_pay_no: ePayNo,
    giro_type: '지방세',
    slip_type: '지방세고지내역조회_법인번호',
    tax_name: taxName,
    bill_org_name: '서울특별시 강남구',
    pay_amount: amount,
    due_date: dueDate,
    detail: {
      bill_org_name: '서울특별시 강남구',
      e_pay_no: ePayNo,
      pay_amount: amount,
      pay_date: dueDate,
      payer_name: '주식회사 데모',
      tax1: Math.floor(amount * 0.8),
      tax2: amount - Math.floor(amount * 0.8),
      tax3: 0,
      tax4: 0,
      tax_base: amount,
      tax_sum: amount,
      tax_name: taxName,
      tax_ym: '202611',
    },
  }
}
