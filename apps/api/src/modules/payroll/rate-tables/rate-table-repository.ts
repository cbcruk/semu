import { Context, Effect, Layer, Option } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { resolveRateTable } from '../engine/rate-table.ts'
import type { PayrollRateTable } from '../engine/rate-table.types.ts'
import { BUILT_IN_RATE_TABLES } from '../engine/rate-tables-2026.ts'

/** 저장된 기준표 한 판입니다. 적용 시작월마다 한 건이고 고치지 않고 새 판을 추가합니다. */
export interface RateTableRecord {
  id: Id<'rateTable'>
  table: PayrollRateTable
}

/**
 * 기준표 ID입니다. 내장 기준표는 적용 시작월에서 만든 고정 ID를 씁니다. 예: `2026-07` → `rtb_00000000000000000000202607`
 */
export function builtInRateTableId(effectiveFrom: string): Id<'rateTable'> {
  return `rtb_${'0'.repeat(20)}${effectiveFrom.replace('-', '')}` as Id<'rateTable'>
}

/** 급여 기준표(요율·한도·세액 산식) 저장소입니다. 회사와 무관한 참조 데이터입니다. */
export class RateTableRepository extends Context.Service<
  RateTableRepository,
  {
    list(): Effect.Effect<ReadonlyArray<RateTableRecord>>
    find(id: Id<'rateTable'>): Effect.Effect<Option.Option<RateTableRecord>>
    /** 그 달(`YYYY-MM`)에 적용하는 기준표입니다. 그 달 이전에 시작한 판이 없으면 `None`입니다. */
    resolve(month: string): Effect.Effect<Option.Option<RateTableRecord>>
  }
>()('semu/payroll/RateTableRepository') {
  /** 내장 기준표(2026-01, 2026-03, 2026-07, 2026-11)를 씁니다. `tables`로 다른 판을 넣을 수 있습니다. */
  static readonly layerMemory = (tables: ReadonlyArray<PayrollRateTable> = BUILT_IN_RATE_TABLES) => {
    const records = [...tables]
      .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
      .map((table) => ({ id: builtInRateTableId(table.effectiveFrom), table }))
    return Layer.succeed(
      RateTableRepository,
      RateTableRepository.of({
        list: () => Effect.succeed(records),
        find: (id) => Effect.succeed(Option.fromNullishOr(records.find((record) => record.id === id))),
        resolve: (month) =>
          Effect.sync(() => {
            try {
              const table = resolveRateTable(tables, month)
              return Option.fromNullishOr(records.find((record) => record.table === table))
            } catch {
              return Option.none()
            }
          }),
      }),
    )
  }
}
