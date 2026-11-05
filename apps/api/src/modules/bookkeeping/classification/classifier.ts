import { Context, Effect, Layer } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { BankTransactionRepository, ClassificationRuleRepository, EvidenceRepository } from '../common/repositories.ts'
import type { ApplyMode, ClassifiableRow, RuleScope } from './classification-rule.types.ts'
import { bankFacts, evidenceFacts, planClassification } from './rule-facts.ts'

/** 규칙을 거래에 적용한 결과입니다. */
export interface ClassifierResult {
  /** 살펴본 행 수입니다. */
  examinedCount: number
  /** 값이 바뀐 행 수입니다. */
  updatedCount: number
}

/** 분류 규칙을 증빙·입출금에 적용합니다. 수집 직후 자동 분류와 "이전 거래에도 적용하기"가 함께 씁니다. */
export class Classifier extends Context.Service<
  Classifier,
  {
    /**
     * 범위의 행에 규칙을 적용합니다. `ruleId`를 주면 그 규칙만, `rowIds`를 주면 그 행만 봅니다.
     */
    apply(
      companyId: Id<'company'>,
      scope: RuleScope,
      options: { mode: ApplyMode; ruleId?: Id<'classificationRule'>; rowIds?: ReadonlySet<string> },
    ): Effect.Effect<ClassifierResult>
  }
>()('semu/bookkeeping/Classifier') {
  static readonly layer = Layer.effect(
    Classifier,
    Effect.gen(function* () {
      const rulesRepo = yield* ClassificationRuleRepository
      const evidenceRepo = yield* EvidenceRepository
      const bankRepo = yield* BankTransactionRepository

      return Classifier.of({
        apply: Effect.fn('Classifier.apply')(function* (companyId, scope, options) {
          const rules = (yield* rulesRepo.list(companyId)).filter(
            (rule) => rule.scope === scope && (options.ruleId === undefined || rule.id === options.ruleId),
          )
          const inScope = (id: string): boolean => options.rowIds === undefined || options.rowIds.has(id)
          if (scope === 'BANK') {
            const rows = (yield* bankRepo.list(companyId)).filter((row) => inScope(row.id))
            const planned = planClassification(rules, rows.map(toRow(bankFacts)), options.mode)
            const byId = new Map(rows.map((row) => [row.id, row]))
            yield* bankRepo.saveAll(
              planned.flatMap(({ rowId, ruleId, update }) => {
                const row = byId.get(rowId as Id<'bankTransaction'>)
                return row === undefined ? [] : [applyUpdate(row, ruleId, update)]
              }),
            )
            return { examinedCount: rows.length, updatedCount: planned.length }
          }
          const side = scope === 'SALES' ? 'SALES' : 'PURCHASE'
          const rows = (yield* evidenceRepo.list(companyId)).filter((row) => row.side === side && inScope(row.id))
          const planned = planClassification(rules, rows.map(toRow(evidenceFacts)), options.mode)
          const byId = new Map(rows.map((row) => [row.id, row]))
          yield* evidenceRepo.saveAll(
            planned.flatMap(({ rowId, ruleId, update }) => {
              const row = byId.get(rowId as Id<'evidence'>)
              return row === undefined ? [] : [applyUpdate(row, ruleId, update)]
            }),
          )
          return { examinedCount: rows.length, updatedCount: planned.length }
        }),
      })
    }),
  )
}

type Classified = {
  id: string
  partnerId: Id<'partner'> | null
  classification: ClassifiableRow['classification']
  version: number
}

function toRow<R extends Classified>(facts: (row: R) => ClassifiableRow['facts']) {
  return (row: R): ClassifiableRow => ({
    id: row.id,
    facts: facts(row),
    classification: row.classification,
    partnerId: row.partnerId,
  })
}

function applyUpdate<R extends Classified>(
  row: R,
  ruleId: string,
  update: { accountTitleId?: string; partnerId?: string },
): R {
  return {
    ...row,
    partnerId: (update.partnerId ?? row.partnerId) as Id<'partner'> | null,
    classification:
      update.accountTitleId === undefined
        ? row.classification
        : {
            accountTitleId: update.accountTitleId as Id<'accountTitle'>,
            method: 'RULE',
            ruleId: ruleId as Id<'classificationRule'>,
          },
    version: row.version + 1,
  }
}
