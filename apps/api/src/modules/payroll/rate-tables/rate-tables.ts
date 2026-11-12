import { Effect, Option } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { CurrentActor } from '../../identity-access/actor.ts'
import { authorize, type AccessDenied } from '../../identity-access/authorization.ts'
import { MULTIPLIERS_FIVE_OR_MORE } from '../engine/working-time.ts'
import { rowItemViolations } from '../items/payroll-item-rules.ts'
import { PayrollItemRepository } from '../items/payroll-item-repository.ts'
import { PayrollRowItemInvalid, RateTableIdNotFound, RateTableNotFound } from '../payroll-problems.ts'
import type { PayrollRowResultValue } from '../rows/payroll-row-input.ts'
import { calculateRow } from '../rows/row-calculation.ts'
import type { SimulationRequest } from './rate-tables.api.ts'
import { rateTableResponse, type RateTable } from './rate-table.ts'
import { RateTableRepository, type RateTableRecord } from './rate-table-repository.ts'
import { BUSINESS_INCOME_CODES, codesInForce, OTHER_INCOME_CODES } from './reference-codes.ts'
import type { ReferenceCode } from './reference-codes.types.ts'

const READ = { permission: 'payroll-rate-table:read', plans: ['PAYROLL'] } as const

/** 기준표 목록입니다. `month`가 있으면 그 달에 적용하는 한 판만 돌려줍니다. */
export const listRateTables = (
  month: string | undefined,
): Effect.Effect<
  { items: Array<typeof RateTable.Type> },
  AccessDenied | RateTableNotFound,
  CurrentActor | RateTableRepository
> =>
  Effect.gen(function* () {
    yield* authorize(READ)
    const repository = yield* RateTableRepository
    if (month === undefined) return { items: (yield* repository.list()).map(rateTableResponse) }
    return { items: [rateTableResponse(yield* resolveOrFail(month))] }
  })

/** 기준표 한 판입니다. */
export const getRateTable = (
  id: Id<'rateTable'>,
): Effect.Effect<typeof RateTable.Type, AccessDenied | RateTableIdNotFound, CurrentActor | RateTableRepository> =>
  Effect.gen(function* () {
    yield* authorize(READ)
    const found = yield* (yield* RateTableRepository).find(id)
    if (Option.isNone(found)) return yield* new RateTableIdNotFound({})
    return rateTableResponse(found.value)
  })

/** 그 달에 쓸 수 있는 사업소득 업종코드와 기타소득 지급사유입니다. 달이 없으면 전체입니다. */
export const listReferenceCodes = (
  month: string | undefined,
): Effect.Effect<{ businessIncome: ReferenceCode[]; otherIncome: ReferenceCode[] }, AccessDenied, CurrentActor> =>
  Effect.gen(function* () {
    yield* authorize(READ)
    return {
      businessIncome: month === undefined ? [...BUSINESS_INCOME_CODES] : codesInForce(BUSINESS_INCOME_CODES, month),
      otherIncome: month === undefined ? [...OTHER_INCOME_CODES] : codesInForce(OTHER_INCOME_CODES, month),
    }
  })

/** 그 달의 기준표를 찾고, 없으면 422 `RATE_TABLE_NOT_FOUND`로 실패합니다. */
export const resolveOrFail = (month: string): Effect.Effect<RateTableRecord, RateTableNotFound, RateTableRepository> =>
  Effect.gen(function* () {
    const found = yield* (yield* RateTableRepository).resolve(month)
    if (Option.isNone(found)) return yield* new RateTableNotFound({ month })
    return found.value
  })

/**
 * 저장하지 않고 한 행을 계산합니다. 행의 지급·공제 항목은 회사 카탈로그에서 풀고, 지운 항목은 받지 않습니다.
 */
export const simulate = (
  request: typeof SimulationRequest.Type,
): Effect.Effect<
  PayrollRowResultValue,
  AccessDenied | RateTableNotFound | PayrollRowItemInvalid,
  CurrentActor | RateTableRepository | PayrollItemRepository
> =>
  Effect.gen(function* () {
    const actor = yield* authorize({ permission: 'payroll-calculator:simulate', plans: ['PAYROLL'] })
    const catalog = yield* (yield* PayrollItemRepository).catalog(actor.companyId)
    const violations = rowItemViolations(request.row, undefined, catalog)
    if (violations.length > 0) return yield* new PayrollRowItemInvalid({ violations })
    const attributionRates = yield* resolveOrFail(request.attributionMonth)
    const paymentRates = yield* resolveOrFail(request.paymentMonth ?? request.attributionMonth)
    return calculateRow(request.row, request.employee ?? null, {
      attributionMonth: request.attributionMonth,
      attributionRates: attributionRates.table,
      paymentRates: paymentRates.table,
      setting: {
        multipliers: request.multipliers ?? MULTIPLIERS_FIVE_OR_MORE,
        deductionMethods: request.deductionMethods ?? {
          nationalPension: 'RATE',
          healthInsurance: 'RATE',
          employmentInsurance: 'RATE',
          incomeTax: 'TAX_TABLE',
        },
      },
      catalog,
    })
  })
