import type { DatabaseSync } from 'node:sqlite'
import type { SeedContext } from '../../../db/seed.types'
import { toPlainDate } from '../../../lib/plain-date'
import { DEFAULT_BOOKKEEPING_POLICY, saveBookkeepingPolicy } from '../settings/bookkeeping-settings'
import { replaceSettlementSnapshot } from './settlement.service'
import type { BsLineInput, CashAccount, CashEntryInput, PartnerBalanceInput, PartnerEntryInput, PlLineInput, SnapshotUpload } from './settlement.types'

const COMPANY = 'c-corp'
const AGENT = 'u-agent'

/** Inserts a demo settlement snapshot for `c-corp` so every tax report renders, and enables premium settlement. */
export function seedSettlementDemo(db: DatabaseSync, context: SeedContext): void {
  saveBookkeepingPolicy(db, COMPANY, { ...DEFAULT_BOOKKEEPING_POLICY, premiumSettlement: true }, context.now)
  const uploads: [number, SnapshotUpload, string][] = [
    [2025, { scope: 'pl', closed_through: toPlainDate('2025-12-31'), lines: plLines(2025, 12) }, '2026-01-10T14:36:45+09:00'],
    [2026, { scope: 'pl', closed_through: toPlainDate('2026-09-30'), lines: plLines(2026, 9) }, '2026-10-15T10:00:00+09:00'],
    [2026, { scope: 'bs', closed_through: toPlainDate('2026-09-30'), rows: bsRows(9) }, '2026-10-15T10:00:00+09:00'],
    [2026, { scope: 'cash', closed_through: toPlainDate('2026-09-30'), ...cashRows(9) }, '2026-10-15T10:00:00+09:00'],
    [2026, { scope: 'ar_ap', closed_through: toPlainDate('2026-09-30'), ...partnerRows(9) }, '2026-10-15T10:00:00+09:00'],
  ]
  for (const [year, upload, now] of uploads) replaceSettlementSnapshot(db, COMPANY, year, upload, { userId: AGENT, now })
}

function plLines(year: number, months: number): PlLineInput[] {
  const lines: PlLineInput[] = []
  const boost = year === 2026 ? 500_000 : 0
  for (let month = 1; month <= months; month++) {
    const add = (section: PlLineInput['section'], path: string, amount: number): void => {
      lines.push({ month, section, path, amount })
    }
    add('매출액', '상품매출', 5_000_000 + 100_000 * month + boost)
    add('매출액', '용역매출', 1_000_000)
    const manufacturing = 2_000_000 + 10_000 * month
    add('매출원가', '', 500_000 + manufacturing - 400_000)
    add('매출원가', '기초제품재고액', 500_000)
    add('매출원가', '당기제품제조원가', manufacturing)
    add('매출원가', '기말제품재고액', 400_000)
    const fees = 100_000 + 5_000 * month
    add('판매비와관리비', '직원급여', 1_500_000)
    add('판매비와관리비', '복리후생비', 200_000)
    add('판매비와관리비', '지급수수료', fees)
    add('판매비와관리비', '지급수수료/카드수수료', 30_000)
    add('판매비와관리비', '지급수수료/기타수수료', fees - 30_000)
    add('판매비와관리비', '지급임차료', 500_000)
    add('영업외수익', '이자수익', 10_000)
    if (year === 2026 && month === 3) add('영업외수익', '국고보조금', 300_000)
    add('영업외비용', '이자비용', 30_000)
    add('법인세등', '', year === 2025 && month === 12 ? 100_000 : 0)
  }
  return lines
}

function bsRows(months: number): BsLineInput[] {
  const rows: BsLineInput[] = []
  for (let month = 1; month <= months; month++) {
    const target = toPlainDate(`2026-${String(month).padStart(2, '0')}-01`)
    const cash = 20_000_000 + 1_000_000 * month
    const current = cash + 8_000_000 + 4_000_000
    const assets = current + 30_000_000
    const liabilities = 28_000_000
    const lines: [string, string | null, number][] = [
      ['자산', null, assets],
      ['Ⅰ.유동자산', '자산', current],
      ['현금및현금성자산', 'Ⅰ.유동자산', cash],
      ['매출채권', 'Ⅰ.유동자산', 8_000_000],
      ['재고자산', 'Ⅰ.유동자산', 4_000_000],
      ['Ⅱ.비유동자산', '자산', 30_000_000],
      ['유형자산', 'Ⅱ.비유동자산', 30_000_000],
      ['부채', null, liabilities],
      ['Ⅰ.유동부채', '부채', 8_000_000],
      ['매입채무', 'Ⅰ.유동부채', 5_000_000],
      ['미지급금', 'Ⅰ.유동부채', 3_000_000],
      ['Ⅱ.비유동부채', '부채', 20_000_000],
      ['장기차입금', 'Ⅱ.비유동부채', 20_000_000],
      ['자본', null, assets - liabilities],
      ['Ⅰ.자본금', '자본', 10_000_000],
      ['Ⅱ.자본잉여금', '자본', 0],
      ['Ⅲ.자본조정', '자본', 0],
      ['Ⅳ.기타포괄손익누계액', '자본', 0],
      ['Ⅴ.이익잉여금', '자본', assets - liabilities - 10_000_000],
    ]
    lines.forEach(([subject, parent, amount], index) => rows.push({ target_month: target, subject, parent_subject: parent, sort_order: index + 1, amount }))
  }
  return rows
}

function cashRows(months: number): { ledger: Extract<SnapshotUpload, { scope: 'cash' }>['ledger']; entries: CashEntryInput[] } {
  const accounts: [CashAccount, number, number, number][] = [
    ['현금', 500_000, 100_000, 80_000],
    ['당좌예금', 1_000_000, 0, 0],
    ['보통예금', 18_000_000, 7_000_000, 6_000_000],
    ['제예금', 500_000, 0, 0],
  ]
  const ledger = []
  for (let month = 1; month <= months; month++) {
    for (const [cashAccount, opening, inflow, outflow] of accounts) {
      ledger.push({ month, cash_account: cashAccount, inflow, outflow, closing_balance: opening + month * (inflow - outflow) })
    }
  }
  const entries: CashEntryInput[] = [
    { date: toPlainDate('2026-01-05'), cash_account: '보통예금', summary: '매출대금 입금', inflow: 7_000_000, outflow: 0, balance: 25_000_000 },
    { date: toPlainDate('2026-01-25'), cash_account: '보통예금', summary: '급여 지급', inflow: 0, outflow: 6_000_000, balance: 19_000_000 },
    { date: toPlainDate('2026-01-31'), cash_account: '현금', summary: '소액 현금 정리', inflow: 100_000, outflow: 80_000, balance: 520_000 },
  ]
  return { ledger, entries }
}

function partnerRows(months: number): { balances: PartnerBalanceInput[]; entries: PartnerEntryInput[] } {
  const partners: [PartnerBalanceInput['kind'], string, string, string, number, number, number][] = [
    ['receivable', '00101', '(주)가나상사', 'IT 서비스 및 컨설팅 외 1건', 3_000_000, 2_000_000, 1_500_000],
    ['receivable', '00102', '다라유통', '상품 판매', 1_000_000, 1_000_000, 1_000_000],
    ['payable', '00201', '마바물산', '원재료 매입 외 1건', 2_000_000, 1_200_000, 1_000_000],
    ['payable', '00202', '사아테크', '장비 유지보수', 500_000, 300_000, 300_000],
  ]
  const balances: PartnerBalanceInput[] = []
  const entries: PartnerEntryInput[] = []
  for (const [kind, code, name, summary, opening, increase, decrease] of partners) {
    let balance = opening
    for (let month = 1; month <= months; month++) {
      const rollover = balance
      const mm = String(month).padStart(2, '0')
      entries.push({ kind, erp_partner_code: code, date: toPlainDate(`2026-${mm}-10`), summary, transaction_amount: increase, balance: rollover + increase })
      balance = rollover + increase - decrease
      entries.push({ kind, erp_partner_code: code, date: toPlainDate(`2026-${mm}-25`), summary: '대금 정산', transaction_amount: -decrease, balance })
      balances.push({
        kind,
        month,
        erp_partner_code: code,
        partner_name: name,
        summary,
        entry_count: 2,
        rollover_balance: rollover,
        increase_amount: increase,
        decrease_amount: decrease,
        balance,
      })
    }
  }
  return { balances, entries }
}
