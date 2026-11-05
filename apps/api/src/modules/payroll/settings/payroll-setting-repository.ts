import { Context, Effect, Layer, Ref } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { defaultPayrollSetting } from './payroll-setting.ts'
import type { PayrollSettingRecord } from './payroll-setting.types.ts'

/** 회사 급여 설정 저장소입니다. 회사마다 한 건이고, 없으면 기본 설정을 돌려줍니다. */
export class PayrollSettingRepository extends Context.Service<
  PayrollSettingRepository,
  {
    get(companyId: Id<'company'>): Effect.Effect<PayrollSettingRecord>
    save(companyId: Id<'company'>, setting: PayrollSettingRecord): Effect.Effect<void>
  }
>()('semu/payroll/PayrollSettingRepository') {
  /** 프로세스 메모리에 둡니다. `seed`는 회사별 초기 설정입니다. */
  static readonly layerMemory = (
    seed: ReadonlyArray<{ companyId: Id<'company'>; setting: PayrollSettingRecord }> = [],
  ) =>
    Layer.effect(
      PayrollSettingRepository,
      Effect.gen(function* () {
        const store = yield* Ref.make(new Map(seed.map((entry) => [entry.companyId, entry.setting])))
        return PayrollSettingRepository.of({
          get: (companyId) => Ref.get(store).pipe(Effect.map((map) => map.get(companyId) ?? defaultPayrollSetting())),
          save: (companyId, setting) => Ref.update(store, (map) => new Map(map).set(companyId, setting)),
        })
      }),
    )
}
