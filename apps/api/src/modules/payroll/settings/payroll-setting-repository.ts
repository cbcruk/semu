import { Context, Effect, Layer, Option } from 'effect'
import { TableFactory } from '../../../shared/persistence/record-table.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { defaultPayrollSetting } from './payroll-setting.ts'
import type { PayrollSettingRecord } from './payroll-setting.types.ts'

/** 표에 저장하는 회사 급여 설정 한 건입니다. 회사마다 한 건이라 ID는 회사 ID입니다. */
interface StoredPayrollSetting {
  id: string
  companyId: Id<'company'>
  setting: PayrollSettingRecord
}

/** 회사 급여 설정 저장소입니다. 회사마다 한 건이고, 없으면 기본 설정을 돌려줍니다. */
export class PayrollSettingRepository extends Context.Service<
  PayrollSettingRepository,
  {
    get(companyId: Id<'company'>): Effect.Effect<PayrollSettingRecord>
    save(companyId: Id<'company'>, setting: PayrollSettingRecord): Effect.Effect<void>
  }
>()('semu/payroll/PayrollSettingRepository') {
  /** `payroll_settings` 표에 둡니다. `seed`는 회사별 초기 설정이고, 표가 비어 있을 때 넣습니다. */
  static readonly layer = (seed: ReadonlyArray<{ companyId: Id<'company'>; setting: PayrollSettingRecord }> = []) =>
    Layer.effect(
      PayrollSettingRepository,
      Effect.gen(function* () {
        const table = yield* (yield* TableFactory).make<StoredPayrollSetting>('payroll_settings', {
          seed: seed.map(({ companyId, setting }) => ({ id: companyId, companyId, setting })),
          companyOf: (record) => record.companyId,
        })
        return PayrollSettingRepository.of({
          get: (companyId) =>
            Effect.map(table.get(companyId), (found) =>
              Option.isSome(found) && found.value.companyId === companyId
                ? found.value.setting
                : defaultPayrollSetting(),
            ),
          save: (companyId, setting) => table.put({ id: companyId, companyId, setting }),
        })
      }),
    )

  /** 프로세스 메모리에 둡니다. `seed`는 회사별 초기 설정입니다. */
  static readonly layerMemory = (
    seed: ReadonlyArray<{ companyId: Id<'company'>; setting: PayrollSettingRecord }> = [],
  ) => PayrollSettingRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}
