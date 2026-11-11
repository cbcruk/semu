import { Effect } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { expectedVersion, withEtag } from '../../../shared/http/versioning.ts'
import type { TaxSettingRepository } from './tax-setting-repository.ts'
import { getTaxSetting, updateTaxSetting } from './tax-settings.ts'

/** `tax-settings` 그룹 핸들러입니다. */
export const TaxSettingsHttpLive = HttpApiBuilder.group(Api, 'tax-settings', (handlers) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<TaxSettingRepository>()
    return handlers
      .handle('get', () => getTaxSetting().pipe(Effect.map(withEtag), Effect.provideContext(context)))
      .handle('update', ({ payload, headers }) =>
        updateTaxSetting(payload, expectedVersion(headers['if-match'])).pipe(
          Effect.map(withEtag),
          Effect.provideContext(context),
        ),
      )
  }),
)
