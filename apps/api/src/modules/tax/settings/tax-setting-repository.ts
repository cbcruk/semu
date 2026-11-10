import { Context, Effect, Layer, Option } from 'effect'
import { TableFactory } from '../../../shared/persistence/record-table.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { defaultTaxSetting } from './tax-setting.ts'
import type { TaxSettingRecord } from './tax-setting.types.ts'

/** 표에 저장하는 회사 세무 설정 한 건입니다. 회사마다 한 건이라 ID는 회사 ID입니다. */
interface StoredTaxSetting {
  id: string
  companyId: Id<'company'>
  setting: TaxSettingRecord
}

/** 회사 세무 설정 저장소입니다. 회사마다 한 건이고, 없으면 기본 설정을 돌려줍니다. */
export class TaxSettingRepository extends Context.Service<
  TaxSettingRepository,
  {
    get(companyId: Id<'company'>): Effect.Effect<TaxSettingRecord>
    save(companyId: Id<'company'>, setting: TaxSettingRecord): Effect.Effect<void>
  }
>()('semu/tax/TaxSettingRepository') {
  /** `tax_settings` 표에 둡니다. `seed`는 회사별 초기 설정이고, 표가 비어 있을 때 넣습니다. */
  static readonly layer = (seed: ReadonlyArray<{ companyId: Id<'company'>; setting: TaxSettingRecord }> = []) =>
    Layer.effect(
      TaxSettingRepository,
      Effect.gen(function* () {
        const table = yield* (yield* TableFactory).make<StoredTaxSetting>('tax_settings', {
          seed: seed.map(({ companyId, setting }) => ({ id: companyId, companyId, setting })),
          companyOf: (record) => record.companyId,
        })
        return TaxSettingRepository.of({
          get: (companyId) =>
            Effect.map(table.get(companyId), (found) =>
              Option.isSome(found) && found.value.companyId === companyId ? found.value.setting : defaultTaxSetting(),
            ),
          save: (companyId, setting) => table.put({ id: companyId, companyId, setting }),
        })
      }),
    )

  /** 프로세스 메모리에 둡니다. `seed`는 회사별 초기 설정입니다. */
  static readonly layerMemory = (seed: ReadonlyArray<{ companyId: Id<'company'>; setting: TaxSettingRecord }> = []) =>
    TaxSettingRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}
