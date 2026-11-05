import type { BankTransactionRecord } from '../bank/bank.types.ts'
import { evidenceAmounts } from '../evidence/evidence-amounts.ts'
import type { EvidenceRecord } from '../evidence/evidence.types.ts'
import type {
  ApplyMode,
  ClassifiableRow,
  ClassificationRuleRecord,
  RuleFacts,
  RuleUpdate,
} from './classification-rule.types.ts'
import { firstMatchingRule, planRuleUpdate } from './rule-matching.ts'

/**
 * 증빙 한 건에서 규칙 조건이 볼 값을 모읍니다.
 *
 * `PARTNER`는 거래처 ID, `COUNTERPARTY`는 증빙에 적힌 상호와 사업자번호, `ITEM`은 품목 요약, 금액은 {@link evidenceAmounts}로 채운 값입니다.
 */
export function evidenceFacts(record: EvidenceRecord): RuleFacts {
  const amounts = evidenceAmounts(record)
  return {
    partner: record.partnerId,
    counterparty: `${record.counterpartyName ?? ''} ${record.counterpartyBusinessNumber ?? ''}`.trim(),
    item: record.itemSummary ?? '',
    totalAmount: amounts.totalAmount,
    supplyAmount: amounts.supplyAmount,
    vatAmount: amounts.vatAmount,
    source: record.source,
    summary: '',
    amount: amounts.totalAmount,
    account: null,
    direction: null,
  }
}

/** 입출금 한 건에서 규칙 조건이 볼 값을 모읍니다. `ACCOUNT`는 은행 계좌 ID입니다. */
export function bankFacts(record: BankTransactionRecord): RuleFacts {
  return {
    partner: record.partnerId,
    counterparty: '',
    item: '',
    totalAmount: record.amount,
    supplyAmount: record.amount,
    vatAmount: 0,
    source: null,
    summary: record.summary ?? '',
    amount: record.amount,
    account: record.bankAccountId,
    direction: record.direction,
  }
}

/** 규칙 적용 결과 한 줄입니다. */
export interface PlannedClassification {
  rowId: string
  ruleId: string
  update: RuleUpdate
}

/**
 * 행마다 처음 맞는 규칙을 찾아 바꿀 값을 정합니다. 숨긴 규칙은 빼고 `priority` 순으로 시도합니다.
 *
 * 규칙 하나만 적용할 때(`/classification-rules/{ruleId}:apply`)는 `rules`에 그 규칙만 넘깁니다.
 */
export function planClassification(
  rules: ReadonlyArray<ClassificationRuleRecord>,
  rows: ReadonlyArray<ClassifiableRow>,
  mode: ApplyMode,
): PlannedClassification[] {
  const active = rules.filter((rule) => rule.status === 'ACTIVE').sort((a, b) => a.priority - b.priority)
  const planned: PlannedClassification[] = []
  for (const row of rows) {
    const rule = firstMatchingRule(active, row.facts)
    if (rule === undefined) continue
    const update = planRuleUpdate(
      row,
      { accountTitleId: rule.resultAccountTitleId, partnerId: rule.resultPartnerId },
      mode,
    )
    if (update !== null) planned.push({ rowId: row.id, ruleId: rule.id, update })
  }
  return planned
}
