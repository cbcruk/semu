import { Context, Effect, Layer } from 'effect'
import { checkVersion } from '../../../shared/http/versioning.ts'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { VersionMismatch } from '../../../shared/problem/problem.ts'
import { ensureAssignable, loadAccountTitleIndex } from '../account-titles/account-title-index.ts'
import { AccountTitleNotAssignable } from '../account-titles/account-title.ts'
import { nowAndToday, orFail } from '../common/lookup.ts'
import { AccountTitleRepository, ClassificationRuleRepository, PartnerRepository } from '../common/repositories.ts'
import { PartnerNotFound } from '../evidence/evidence.ts'
import type { EvidenceSource } from '../evidence/evidence.types.ts'
import { PURCHASE_SOURCES } from '../ingestion/ingestion-plan.ts'
import type { ClassificationRule, RuleApplyJob } from './classification-rule.ts'
import {
  ClassificationRuleInvalid,
  ClassificationRuleNotFound,
  ClassificationRuleOrderMismatch,
} from './classification-rule.ts'
import type {
  ApplyMode,
  ClassificationRuleRecord,
  RuleCondition,
  RuleScope,
  RuleStatus,
} from './classification-rule.types.ts'
import { Classifier } from './classifier.ts'
import { conditionViolations } from './rule-matching.ts'

/** 규칙 본문입니다. 추가와 수정이 함께 씁니다. */
export interface RuleDraft {
  scope: RuleScope
  source: EvidenceSource | null
  name: string
  conditions: ReadonlyArray<RuleCondition>
  resultAccountTitleId: Id<'accountTitle'> | null
  resultPartnerId: Id<'partner'> | null
  status: RuleStatus
}

type DraftError = ClassificationRuleInvalid | AccountTitleNotAssignable | PartnerNotFound

function toRule(record: ClassificationRuleRecord): ClassificationRule {
  return {
    ...record,
    source: record.source as EvidenceSource | null,
    conditions: record.conditions.map((condition) => ({
      field: condition.field,
      operator: condition.operator,
      ...(condition.values === undefined ? {} : { values: [...condition.values] }),
      ...(condition.min === undefined ? {} : { min: condition.min }),
      ...(condition.max === undefined ? {} : { max: condition.max }),
    })),
  }
}

/** 자동 분류 규칙 관리와 적용입니다. */
export class ClassificationRuleService extends Context.Service<
  ClassificationRuleService,
  {
    list(
      companyId: Id<'company'>,
      filter: { scope?: RuleScope; includeHidden: boolean },
    ): Effect.Effect<ClassificationRule[]>
    create(companyId: Id<'company'>, draft: Omit<RuleDraft, 'status'>): Effect.Effect<ClassificationRule, DraftError>
    update(
      companyId: Id<'company'>,
      id: Id<'classificationRule'>,
      changes: Partial<Omit<RuleDraft, 'scope'>>,
      expectedVersion: number | undefined,
    ): Effect.Effect<ClassificationRule, ClassificationRuleNotFound | DraftError | VersionMismatch>
    remove(companyId: Id<'company'>, id: Id<'classificationRule'>): Effect.Effect<void, ClassificationRuleNotFound>
    /** 범위 안 규칙의 순서를 통째로 바꿉니다. 보낸 순서가 우선순위입니다. */
    reorder(
      companyId: Id<'company'>,
      scope: RuleScope,
      ids: ReadonlyArray<Id<'classificationRule'>>,
    ): Effect.Effect<ClassificationRule[], ClassificationRuleOrderMismatch>
    /** 이전 거래에 적용합니다. `ruleId`가 없으면 범위의 규칙 전체를 우선순위대로 적용합니다. */
    apply(
      companyId: Id<'company'>,
      target: { ruleId: Id<'classificationRule'> } | { scope: RuleScope },
      mode: ApplyMode,
    ): Effect.Effect<RuleApplyJob, ClassificationRuleNotFound>
  }
>()('semu/bookkeeping/ClassificationRuleService') {
  static readonly layer = Layer.effect(
    ClassificationRuleService,
    Effect.gen(function* () {
      const repository = yield* ClassificationRuleRepository
      const titles = yield* AccountTitleRepository
      const partners = yield* PartnerRepository
      const classifier = yield* Classifier

      const find = (companyId: Id<'company'>, id: Id<'classificationRule'>) =>
        orFail(repository.findById(companyId, id), () => new ClassificationRuleNotFound({}))

      const validate = Effect.fn('ClassificationRuleService.validate')(function* (
        companyId: Id<'company'>,
        draft: Omit<RuleDraft, 'status'>,
      ) {
        const violations: Array<ClassificationRuleInvalid['violations'][number]> = conditionViolations(
          draft.scope,
          draft.conditions,
        )
        if (draft.resultAccountTitleId === null && draft.resultPartnerId === null) {
          violations.push({ index: -1, code: 'RESULT_REQUIRED' })
        }
        if (
          draft.source !== null &&
          (draft.scope === 'BANK' || (draft.scope === 'PURCHASE' && !PURCHASE_SOURCES.includes(draft.source)))
        ) {
          violations.push({ index: -1, code: 'SOURCE_NOT_ALLOWED' })
        }
        if (violations.length > 0) return yield* new ClassificationRuleInvalid({ violations })
        if (draft.resultAccountTitleId !== null) {
          const index = yield* Effect.provideService(loadAccountTitleIndex(companyId), AccountTitleRepository, titles)
          if (draft.scope === 'BANK') {
            const deposit = ensureAssignable(index, draft.resultAccountTitleId, 'DEPOSIT')
            yield* Effect.catchTag(deposit, 'AccountTitleNotAssignable', (error) =>
              error.reason === 'SCOPE_MISMATCH'
                ? ensureAssignable(index, draft.resultAccountTitleId!, 'WITHDRAWAL')
                : Effect.fail(error),
            )
          } else {
            yield* ensureAssignable(index, draft.resultAccountTitleId, draft.scope)
          }
        }
        if (draft.resultPartnerId !== null) {
          const partner = yield* partners.findById(companyId, draft.resultPartnerId)
          if (partner._tag === 'None' || partner.value.deletedAt !== null) return yield* new PartnerNotFound({})
        }
      })

      return ClassificationRuleService.of({
        list: (companyId, filter) =>
          Effect.map(repository.list(companyId), (rows) =>
            rows
              .filter(
                (row) =>
                  (filter.scope === undefined || row.scope === filter.scope) &&
                  (filter.includeHidden || row.status === 'ACTIVE'),
              )
              .sort((a, b) => a.scope.localeCompare(b.scope) || a.priority - b.priority)
              .map(toRule),
          ),

        create: Effect.fn('ClassificationRuleService.create')(function* (companyId, draft) {
          yield* validate(companyId, draft)
          const { now } = yield* nowAndToday
          const siblings = (yield* repository.list(companyId)).filter((row) => row.scope === draft.scope)
          const record: ClassificationRuleRecord = {
            id: newId('classificationRule'),
            companyId,
            ...draft,
            priority: Math.max(0, ...siblings.map((row) => row.priority)) + 1,
            status: 'ACTIVE',
            createdAt: now,
            updatedAt: now,
            version: 1,
          }
          yield* repository.save(record)
          return toRule(record)
        }),

        update: Effect.fn('ClassificationRuleService.update')(function* (companyId, id, changes, expectedVersion) {
          const record = yield* find(companyId, id)
          yield* checkVersion(record.version, expectedVersion)
          const merged = { ...record, source: record.source as EvidenceSource | null, ...changes }
          yield* validate(companyId, merged)
          const { now } = yield* nowAndToday
          const next: ClassificationRuleRecord = { ...merged, updatedAt: now, version: record.version + 1 }
          yield* repository.save(next)
          return toRule(next)
        }),

        remove: (companyId, id) => Effect.flatMap(find(companyId, id), () => repository.remove(companyId, id)),

        reorder: Effect.fn('ClassificationRuleService.reorder')(function* (companyId, scope, ids) {
          const rows = (yield* repository.list(companyId)).filter((row) => row.scope === scope)
          const byId = new Map(rows.map((row) => [row.id, row]))
          if (ids.length !== rows.length || new Set(ids).size !== ids.length || ids.some((id) => !byId.has(id))) {
            return yield* new ClassificationRuleOrderMismatch({})
          }
          const reordered = ids.map((id, index) => {
            const row = byId.get(id)!
            return row.priority === index + 1 ? row : { ...row, priority: index + 1, version: row.version + 1 }
          })
          yield* repository.saveAll(reordered)
          return reordered.map(toRule)
        }),

        apply: Effect.fn('ClassificationRuleService.apply')(function* (companyId, target, mode) {
          const scope = 'ruleId' in target ? (yield* find(companyId, target.ruleId)).scope : target.scope
          const { now: createdAt } = yield* nowAndToday
          const result = yield* classifier.apply(companyId, scope, {
            mode,
            ...('ruleId' in target ? { ruleId: target.ruleId } : {}),
          })
          const { now: finishedAt } = yield* nowAndToday
          return { id: newId('job'), status: 'SUCCEEDED' as const, result, createdAt, finishedAt }
        }),
      })
    }),
  )
}
