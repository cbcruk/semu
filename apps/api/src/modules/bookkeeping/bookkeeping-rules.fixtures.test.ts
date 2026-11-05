import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Id } from '../../shared/ids/ids.types.ts'
import {
  assignabilityProblem,
  deletionProblem,
  indexAccountTitles,
  planChildCreation,
} from './account-titles/account-title-tree.ts'
import { SYSTEM_ACCOUNT_TITLES, systemAccountTitleIdOf } from './account-titles/system-account-titles.ts'
import { closingBalanceOn, derivedClosing, mergeSnapshot } from './bank/balance-snapshot.ts'
import { settlementLinkProblem, settlementMatchStatus } from './bank/settlement-status.ts'
import type { RuleFacts } from './classification/classification-rule.types.ts'
import { conditionViolations, matchesRule, planRuleUpdate } from './classification/rule-matching.ts'
import { evidenceAmounts } from './evidence/evidence-amounts.ts'
import { refreshStep, transitionGiro } from './giros/giro-status.ts'
import { cardApprovalEvidence, evidenceRejection, processingOrder } from './ingestion/ingestion-plan.ts'
import { isBusinessStatusFresh } from './partners/business-status-cache.ts'
import { outstandingByPartner } from './partners/outstanding.ts'
import { cashFlowFigures } from './reports/cash-status.ts'
import { realtimeProfitLoss } from './reports/realtime-pl.ts'
import { approximateVatDueDate, daysUntilDue } from './reports/vat-due-date.ts'
import { itemSummary, statementLock, statementProblems } from './sales-transactions/statement-validation.ts'

/**
 * 현행 규칙 픽스처(`test/fixtures/rules/<rule>.json`)를 재설계 순수 함수로 돌립니다.
 *
 * 픽스처 기대값은 현행 코드를 따라간 값입니다. 결정(`docs/design/rule-decisions/bookkeeping.md`)으로 바뀐 케이스는
 * `CHANGED`에 새 기대값과 결정 번호를 적었습니다.
 */

interface FixtureCase {
  name: string
  input: Record<string, any>
  expected: any
}

const FIXTURE_DIR = join(import.meta.dirname, '../../../test/fixtures/rules')

function casesOf(rule: string): FixtureCase[] {
  return (JSON.parse(readFileSync(join(FIXTURE_DIR, `${rule}.json`), 'utf8')) as { cases: FixtureCase[] }).cases
}

const CHANGED: Record<string, { expected: unknown; decision: string }> = {
  'business-status-cache/an early morning lookup stored in UTC': {
    expected: true,
    decision: 'business-status-cache 1',
  },
  'scraped-record-ingestion/a card approval stamped in UTC': {
    expected: {
      externalKey: '30012347:1234-****-****-5678:2026-10-13T16:30:00Z',
      writtenOn: '2026-10-14',
      totalAmount: 11000,
      supplyAmount: 10000,
      vatAmount: 1000,
      isCanceled: false,
    },
    decision: 'scraped-record-ingestion 1',
  },
  'scraped-record-ingestion/evidence without amounts': {
    expected: 'AMOUNTS_MISSING',
    decision: 'scraped-record-ingestion 2',
  },
  'scraped-record-ingestion/PG evidence sent as purchase': {
    expected: 'SOURCE_SIDE_MISMATCH',
    decision: 'scraped-record-ingestion 2',
  },
  'scraped-record-ingestion/evidence with a blank external key': {
    expected: 'EXTERNAL_KEY_MISSING',
    decision: 'scraped-record-ingestion 2',
  },
}

const EMPTY_FACTS: RuleFacts = {
  partner: null,
  counterparty: '',
  item: '',
  totalAmount: 0,
  supplyAmount: 0,
  vatAmount: 0,
  source: null,
  summary: '',
  amount: 0,
  account: null,
  direction: null,
}

const TITLES = indexAccountTitles(SYSTEM_ACCOUNT_TITLES)

function titleId(code: string): Id<'accountTitle'> {
  return code === 'unknown' ? ('acc_unknown' as Id<'accountTitle'>) : systemAccountTitleIdOf(code)
}

function pick(source: Record<string, any>, keys: ReadonlyArray<string>): Record<string, unknown> {
  return Object.fromEntries(keys.map((key) => [key, source[key]]))
}

const RUNNERS: Record<string, (input: Record<string, any>) => unknown> = {
  'classification-rule-matching': (input) =>
    input['call'] === 'matches'
      ? matchesRule(input['rule'], { ...EMPTY_FACTS, ...input['facts'] })
      : conditionViolations(input['scope'], input['conditions']),
  'classification-apply-mode': (input) =>
    planRuleUpdate(
      {
        classification: {
          accountTitleId: input['row'].accountTitleId,
          method: input['row'].method,
        } as any,
        partnerId: input['row'].partnerId,
      },
      input['result'],
      input['mode'],
    ),
  'account-title-constraints': (input) => {
    if (input['call'] === 'assignability')
      return assignabilityProblem(TITLES, titleId(input['code']), input['scope']) ?? null
    if (input['call'] === 'childCreation') return planChildCreation(input as any)
    const target = { id: 'acc_target' as Id<'accountTitle'>, origin: input['target'].origin }
    const moveTo = input['moveTo'] as string
    return (
      deletionProblem({
        target,
        hasChildren: input['hasChildren'],
        classifiedCount: input['classifiedCount'],
        moveToId: moveTo === 'none' ? undefined : moveTo === 'self' ? target.id : titleId(moveTo),
        index: TITLES,
      }) ?? null
    )
  },
  'settlement-match-status': (input) =>
    input['call'] === 'status'
      ? settlementMatchStatus({
          account: input['groupCode'] === null ? undefined : { groupCode: input['groupCode'] },
          partnerId: input['partnerId'],
          amount: input['amount'],
          linkedAmount: input['linkedAmount'],
        })
      : (settlementLinkProblem(input as any) ?? null),
  'partner-outstanding-amount': (input) =>
    Object.fromEntries(
      outstandingByPartner(
        (input['evidence'] as Array<Record<string, any>>).map((row) => ({
          side: row['side'],
          partnerId: row['partnerId'],
          classified: row['classified'],
          totalAmount: evidenceAmounts(row as any).totalAmount,
          settledAmount: row['settledAmount'],
        })),
      ),
    ),
  'bank-balance-snapshot': (input) => {
    if (input['call'] === 'merge') {
      return mergeSnapshot(input['current'] === null ? undefined : { source: input['current'] }, {
        source: input['incoming'],
      })
    }
    if (input['call'] === 'closing') return closingBalanceOn(input['snapshots'], input['date'])
    return derivedClosing(input['transactions']) ?? null
  },
  'realtime-pl-inclusion': (input) => {
    const month = input['month'] as string
    const code = (account: string | null): string | null => (account === null ? null : titleId(account))
    const result = realtimeProfitLoss({
      year: Number(month.slice(0, 4)),
      cumulative: input['cumulative'] ?? false,
      policy: input['policy'] ?? { basis: 'SUPPLY', includeBank: true },
      titles: TITLES,
      evidence: (input['evidence'] as Array<Record<string, any>>).map((row) => ({
        side: row['side'],
        date: row['date'],
        accountTitleId: code(row['account']),
        supplyAmount: row['supplyAmount'],
        totalAmount: row['totalAmount'],
      })),
      bank: (input['bank'] as Array<Record<string, any>>).map((row) => ({
        date: row['date'],
        accountTitleId: code(row['account']),
        amount: row['amount'],
      })),
    })
    const figures = result.months.find((row) => row.month === month)!
    return {
      ...pick(figures, [
        'revenueAmount',
        'costOfSalesAmount',
        'sgaAmount',
        'nonOperatingIncomeAmount',
        'netIncomeAmount',
      ]),
      unclassifiedCount: result.unclassifiedCount,
    }
  },
  'cash-status-other-change': (input) =>
    cashFlowFigures({
      snapshotsByAccount: input['snapshotsByAccount'],
      transactions: (input['transactions'] as number[]).map((amount) => ({ amount })),
      start: input['start'],
      end: input['end'],
    }),
  'business-status-cache': (input) => isBusinessStatusFresh(input['checkedAt'], input['today']),
  'scraped-record-ingestion': (input) => {
    if (input['call'] === 'order') return processingOrder((input['types'] as string[]).map((type) => ({ type }) as any))
    if (input['call'] === 'card') {
      return pick(cardApprovalEvidence(input['record']), [
        'externalKey',
        'writtenOn',
        'totalAmount',
        'supplyAmount',
        'vatAmount',
        'isCanceled',
      ])
    }
    return evidenceRejection(input['record']) ?? null
  },
  'vat-due-date-approximation': (input) => {
    const dueDate = approximateVatDueDate(input['periodEnd'])
    return { dueDate, daysUntilDue: daysUntilDue(input['today'], dueDate) }
  },
  'evidence-amounts': (input) => pick(evidenceAmounts(input as any), ['supplyAmount', 'vatAmount', 'totalAmount']),
  'giro-status-transitions': (input) =>
    input['call'] === 'command'
      ? (transitionGiro(input['from'], input['command']) ?? null)
      : (refreshStep(input['current'] ?? undefined, input['seen'] ?? undefined) ?? null),
  'sales-statement-totals': (input) => {
    if (input['call'] === 'validate') return statementProblems(input['statement'])
    if (input['call'] === 'lock') return statementLock(input['invoices'])
    return itemSummary(input['items'])
  },
}

describe.each(Object.keys(RUNNERS))('%s', (rule) => {
  const run = RUNNERS[rule]!
  it.each(casesOf(rule).map((testCase) => [testCase.name, testCase] as const))('%s', (name, testCase) => {
    const changed = CHANGED[`${rule}/${name}`]
    expect(run(testCase.input)).toEqual(changed === undefined ? testCase.expected : changed.expected)
  })
})
