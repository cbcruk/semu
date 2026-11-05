import { DateTime, Effect, Option } from 'effect'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../../api.ts'
import { newId } from '../../../shared/ids/ids.ts'
import { authorize } from '../../identity-access/authorization.ts'
import { documentsAccess } from '../shared/documents-schemas.ts'
import { canAddCompanySeal } from '../templates/esign-settings-limits.ts'
import {
  CompanySealLimitExceeded,
  CompanySealNotFound,
  CompanySealRepository,
  type CompanySeal,
  type CompanySealRecord,
} from './company-seal.ts'

const toView = (seal: CompanySealRecord): CompanySeal => ({
  id: seal.id,
  name: seal.name,
  source: seal.source,
  imageFileId: seal.imageFileId,
  createdAt: seal.createdAt,
})

/** 회사 도장 핸들러입니다. 모두 행위자 회사의 도장만 다룹니다. */
export const CompanySealsHttpLive = HttpApiBuilder.group(
  Api,
  'companySeals',
  Effect.fn(function* (handlers) {
    const seals = yield* CompanySealRepository
    const active = (companyId: CompanySealRecord['companyId']) =>
      Effect.map(seals.list(companyId), (all) => all.filter((seal) => seal.deletedAt === undefined))

    return handlers.handleAll({
      list: () =>
        authorize(documentsAccess('company-seal:read')).pipe(
          Effect.flatMap((actor) => active(actor.companyId)),
          Effect.map((all) => ({ items: all.map(toView) })),
        ),
      create: ({ payload }) =>
        Effect.gen(function* () {
          const actor = yield* authorize(documentsAccess('company-seal:create'))
          if (!canAddCompanySeal((yield* active(actor.companyId)).length)) {
            return yield* new CompanySealLimitExceeded({})
          }
          const now = yield* DateTime.now
          const record: CompanySealRecord = {
            id: newId('companySeal', DateTime.toEpochMillis(now)),
            companyId: actor.companyId,
            name: payload.name,
            source: payload.source,
            imageFileId: payload.imageFileId,
            createdAt: DateTime.formatIso(now),
          }
          yield* seals.save(record)
          return toView(record)
        }),
      remove: ({ params }) =>
        Effect.gen(function* () {
          const actor = yield* authorize(documentsAccess('company-seal:delete'))
          const found = yield* seals.findActive(actor.companyId, params.id)
          if (Option.isNone(found)) return yield* new CompanySealNotFound({})
          yield* seals.save({ ...found.value, deletedAt: DateTime.formatIso(yield* DateTime.now) })
        }),
    })
  }),
)
