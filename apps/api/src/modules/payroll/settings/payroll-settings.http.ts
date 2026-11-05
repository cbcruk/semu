import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { expectedVersion, withEtag } from '../../../shared/http/versioning.ts'
import type { PayrollSettingRepository } from './payroll-setting-repository.ts'
import { getPayrollSetting, updatePayrollSetting } from './payroll-settings.ts'

/** `payroll-settings` 그룹 핸들러입니다. */
export const PayrollSettingsHttpLive = HttpApiBuilder.group(Api, 'payroll-settings', (handlers) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<PayrollSettingRepository>()
    return handlers
      .handle('get', () => getPayrollSetting().pipe(Effect.map(withEtag), Effect.provideContext(context)))
      .handle('update', ({ payload, headers }) =>
        updatePayrollSetting(payload, expectedVersion(headers['if-match'])).pipe(
          Effect.map(withEtag),
          Effect.provideContext(context),
        ),
      )
  }),
)
