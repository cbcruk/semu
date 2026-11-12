import { Clock, Effect, Option } from 'effect'
import { checkVersion } from '../../../shared/http/versioning.ts'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { VersionMismatch } from '../../../shared/problem/problem.ts'
import type { CurrentActor } from '../../identity-access/actor.ts'
import type { Permission } from '../../identity-access/actor.types.ts'
import { authorize, type AccessDenied } from '../../identity-access/authorization.ts'
import { LEDGER_PLANS } from '../payroll-access.ts'
import { PayrollItemArchived, PayrollItemInvalid, PayrollItemNotFound } from '../payroll-problems.ts'
import { PAYMENT_ITEM_CATEGORIES } from './payment-item-categories.ts'
import {
  type DeductionItem,
  deductionItemResponse,
  type CreateDeductionItem,
  type CreatePaymentItem,
  type PaymentItem,
  type PaymentItemCategorySchema,
  paymentItemResponse,
  type UpdateDeductionItem,
  type UpdatePaymentItem,
} from './payroll-item.ts'
import { deductionItemFieldsOf, type FieldsOrViolations, paymentItemFieldsOf } from './payroll-item-rules.ts'
import { PayrollItemRepository } from './payroll-item-repository.ts'
import type { DeductionItemRecord, PaymentItemRecord } from './payroll-item.types.ts'

type Run<A, E = never> = Effect.Effect<A, E | AccessDenied, CurrentActor | PayrollItemRepository>
type PaymentItemResponse = typeof PaymentItem.Type
type DeductionItemResponse = typeof DeductionItem.Type

const nowIso = Effect.map(Clock.currentTimeMillis, (millis) => new Date(millis).toISOString())

/** 급여대장을 여는 플랜이면 항목도 엽니다. 기장 고객의 대장도 수당·공제 항목이 필요해서입니다. */
const access = (permission: Permission) => authorize({ permission, plans: LEDGER_PLANS, requiresTerms: true })

/** 만든 순서입니다. 지운 항목은 `includeArchived`일 때만 싣습니다. */
function listed<T extends { archivedAt: string | null; createdAt: string; id: string }>(
  records: ReadonlyArray<T>,
  includeArchived: boolean,
): T[] {
  return records
    .filter((record) => includeArchived || record.archivedAt === null)
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
}

function fieldsOrFail<T>(result: FieldsOrViolations<T>): Effect.Effect<T, PayrollItemInvalid> {
  return result.ok
    ? Effect.succeed(result.fields)
    : Effect.fail(new PayrollItemInvalid({ violations: [...result.violations] }))
}

/** 표준 지급 항목 목록입니다. 회사와 상관없는 참조 데이터입니다. */
export const listPaymentItemCategories = (): Run<{ items: Array<typeof PaymentItemCategorySchema.Type> }> =>
  Effect.gen(function* () {
    yield* access('payment-item:read')
    return { items: PAYMENT_ITEM_CATEGORIES.map((category) => ({ ...category })) }
  })

/** 회사 지급 항목 목록입니다. */
export const listPaymentItems = (includeArchived: boolean): Run<{ items: PaymentItemResponse[] }> =>
  Effect.gen(function* () {
    const actor = yield* access('payment-item:read')
    const records = yield* (yield* PayrollItemRepository).paymentItems.list(actor.companyId)
    return { items: listed(records, includeArchived).map(paymentItemResponse) }
  })

/** 지급 항목 하나입니다. 지운 항목도 읽을 수 있습니다. */
export const getPaymentItem = (id: Id<'paymentItem'>): Run<PaymentItemResponse, PayrollItemNotFound> =>
  Effect.gen(function* () {
    const actor = yield* access('payment-item:read')
    return paymentItemResponse(yield* findPaymentItem(actor.companyId, id))
  })

/** 지급 항목을 만듭니다. 표준 항목을 불러오거나 과세 항목을 직접 만듭니다. */
export const createPaymentItem = (
  payload: typeof CreatePaymentItem.Type,
): Run<PaymentItemResponse, PayrollItemInvalid> =>
  Effect.gen(function* () {
    const actor = yield* access('payment-item:create')
    const repository = yield* PayrollItemRepository
    const others = yield* repository.paymentItems.list(actor.companyId)
    const fields = yield* fieldsOrFail(paymentItemFieldsOf(payload, undefined, others))
    const now = yield* nowIso
    const record: PaymentItemRecord = {
      id: newId('paymentItem'),
      companyId: actor.companyId,
      ...fields,
      archivedAt: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    }
    yield* repository.paymentItems.save(record)
    return paymentItemResponse(record)
  })

/** 지급 항목을 고칩니다. 바뀐 속성은 다음에 계산하는 행부터 씁니다. 마감한 대장의 결과는 그대로입니다. */
export const updatePaymentItem = (
  id: Id<'paymentItem'>,
  patch: typeof UpdatePaymentItem.Type,
  expected: number | undefined,
): Run<PaymentItemResponse, PayrollItemNotFound | PayrollItemArchived | PayrollItemInvalid | VersionMismatch> =>
  Effect.gen(function* () {
    const actor = yield* access('payment-item:update')
    const record = yield* findPaymentItem(actor.companyId, id)
    yield* checkVersion(record.version, expected)
    if (record.archivedAt !== null) return yield* new PayrollItemArchived({})
    const repository = yield* PayrollItemRepository
    const others = yield* repository.paymentItems.list(actor.companyId)
    const fields = yield* fieldsOrFail(paymentItemFieldsOf(patch, record, others))
    const next: PaymentItemRecord = { ...record, ...fields, version: record.version + 1, updatedAt: yield* nowIso }
    yield* repository.paymentItems.save(next)
    return paymentItemResponse(next)
  })

/**
 * 지급 항목을 지웁니다(보관). 목록과 새 행 입력에서 빠지고, 이미 그 항목을 넣은 행은 그대로 계산합니다.
 * 이미 지운 항목이면 아무것도 하지 않습니다.
 */
export const deletePaymentItem = (id: Id<'paymentItem'>): Run<void, PayrollItemNotFound> =>
  Effect.gen(function* () {
    const actor = yield* access('payment-item:delete')
    const record = yield* findPaymentItem(actor.companyId, id)
    if (record.archivedAt !== null) return
    const now = yield* nowIso
    yield* (yield* PayrollItemRepository).paymentItems.save({
      ...record,
      archivedAt: now,
      version: record.version + 1,
      updatedAt: now,
    })
  })

/** 회사 공제 항목 목록입니다. */
export const listDeductionItems = (includeArchived: boolean): Run<{ items: DeductionItemResponse[] }> =>
  Effect.gen(function* () {
    const actor = yield* access('deduction-item:read')
    const records = yield* (yield* PayrollItemRepository).deductionItems.list(actor.companyId)
    return { items: listed(records, includeArchived).map(deductionItemResponse) }
  })

/** 공제 항목 하나입니다. 지운 항목도 읽을 수 있습니다. */
export const getDeductionItem = (id: Id<'deductionItem'>): Run<DeductionItemResponse, PayrollItemNotFound> =>
  Effect.gen(function* () {
    const actor = yield* access('deduction-item:read')
    return deductionItemResponse(yield* findDeductionItem(actor.companyId, id))
  })

/** 공제 항목을 만듭니다. */
export const createDeductionItem = (
  payload: typeof CreateDeductionItem.Type,
): Run<DeductionItemResponse, PayrollItemInvalid> =>
  Effect.gen(function* () {
    const actor = yield* access('deduction-item:create')
    const repository = yield* PayrollItemRepository
    const others = yield* repository.deductionItems.list(actor.companyId)
    const fields = yield* fieldsOrFail(deductionItemFieldsOf(payload, undefined, others))
    const now = yield* nowIso
    const record: DeductionItemRecord = {
      id: newId('deductionItem'),
      companyId: actor.companyId,
      ...fields,
      archivedAt: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    }
    yield* repository.deductionItems.save(record)
    return deductionItemResponse(record)
  })

/** 공제 항목을 고칩니다. */
export const updateDeductionItem = (
  id: Id<'deductionItem'>,
  patch: typeof UpdateDeductionItem.Type,
  expected: number | undefined,
): Run<DeductionItemResponse, PayrollItemNotFound | PayrollItemArchived | PayrollItemInvalid | VersionMismatch> =>
  Effect.gen(function* () {
    const actor = yield* access('deduction-item:update')
    const record = yield* findDeductionItem(actor.companyId, id)
    yield* checkVersion(record.version, expected)
    if (record.archivedAt !== null) return yield* new PayrollItemArchived({})
    const repository = yield* PayrollItemRepository
    const others = yield* repository.deductionItems.list(actor.companyId)
    const fields = yield* fieldsOrFail(deductionItemFieldsOf(patch, record, others))
    const next: DeductionItemRecord = { ...record, ...fields, version: record.version + 1, updatedAt: yield* nowIso }
    yield* repository.deductionItems.save(next)
    return deductionItemResponse(next)
  })

/** 공제 항목을 지웁니다(보관). 지급 항목과 같습니다. */
export const deleteDeductionItem = (id: Id<'deductionItem'>): Run<void, PayrollItemNotFound> =>
  Effect.gen(function* () {
    const actor = yield* access('deduction-item:delete')
    const record = yield* findDeductionItem(actor.companyId, id)
    if (record.archivedAt !== null) return
    const now = yield* nowIso
    yield* (yield* PayrollItemRepository).deductionItems.save({
      ...record,
      archivedAt: now,
      version: record.version + 1,
      updatedAt: now,
    })
  })

function findPaymentItem(
  companyId: Id<'company'>,
  id: Id<'paymentItem'>,
): Effect.Effect<PaymentItemRecord, PayrollItemNotFound, PayrollItemRepository> {
  return Effect.gen(function* () {
    const found = yield* (yield* PayrollItemRepository).paymentItems.find(companyId, id)
    if (Option.isNone(found)) return yield* new PayrollItemNotFound({})
    return found.value
  })
}

function findDeductionItem(
  companyId: Id<'company'>,
  id: Id<'deductionItem'>,
): Effect.Effect<DeductionItemRecord, PayrollItemNotFound, PayrollItemRepository> {
  return Effect.gen(function* () {
    const found = yield* (yield* PayrollItemRepository).deductionItems.find(companyId, id)
    if (Option.isNone(found)) return yield* new PayrollItemNotFound({})
    return found.value
  })
}
