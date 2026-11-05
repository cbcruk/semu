import { Context, Effect, Layer, Option, Ref, Schema } from 'effect'
import { HttpApiError } from 'effect/http-api'
import { IdSchema } from '../../../shared/ids/id-schema.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { problemType } from '../../../shared/problem/problem.ts'

/** 홈택스 수임동의 ID입니다. 예: `dlg_01J...` */
export const HometaxDelegationId = IdSchema('hometaxDelegation')

/**
 * 세무대리인 수임동의 상태입니다.
 *
 * - `REQUESTED`: 대리인이 홈택스에 수임을 등록했고 납세자 동의를 기다립니다
 * - `AGREED`: 납세자가 동의했습니다. 세무 기장 전환의 필수 단계입니다
 * - `REVOKED`: 해지됐습니다
 */
export const DelegationStatus = Schema.Literals(['REQUESTED', 'AGREED', 'REVOKED'])

/** 홈택스 세무대리인 수임동의입니다. 현행 sf `/api/company/hometax/`를 대신합니다. */
export const HometaxDelegation = Schema.Struct({
  id: HometaxDelegationId,
  agencyName: Schema.String,
  status: DelegationStatus,
  requestedAt: Schema.String,
  agreedAt: Schema.optionalKey(Schema.String),
  allowedActions: Schema.Array(Schema.Literals(['AGREE'])),
})

/** 홈택스 수임동의입니다. */
export type HometaxDelegation = typeof HometaxDelegation.Type

/** 저장소가 가진 수임동의입니다. */
export interface DelegationRecord {
  id: Id<'hometaxDelegation'>
  companyId: Id<'company'>
  agencyName: string
  status: typeof DelegationStatus.Type
  requestedAt: string
  agreedAt?: string
  agreedBy?: Id<'user'>
}

/** 수임동의 요청입니다. 대표자 홈택스 로그인 정보는 이 요청에만 쓰고 저장하지 않습니다. */
export const DelegationConsentRequest = Schema.Struct({
  hometaxLoginId: Schema.NonEmptyString,
  hometaxPassword: Schema.NonEmptyString,
})

/** 요청한 수임동의가 이 회사에 없습니다. */
export class DelegationNotFound extends HttpApiError.Problem<DelegationNotFound>()(
  'DelegationNotFound',
  { type: problemType('HOMETAX_DELEGATION_NOT_FOUND'), status: 404, title: 'Hometax delegation not found' },
  { code: Schema.tag('HOMETAX_DELEGATION_NOT_FOUND') },
) {}

/** 동의를 기다리는 상태가 아닙니다. */
export class DelegationTransitionInvalid extends HttpApiError.Problem<DelegationTransitionInvalid>()(
  'DelegationTransitionInvalid',
  {
    type: problemType('HOMETAX_DELEGATION_TRANSITION_INVALID'),
    status: 409,
    title: 'Delegation is not awaiting consent',
  },
  { code: Schema.tag('HOMETAX_DELEGATION_TRANSITION_INVALID'), currentStatus: DelegationStatus },
) {}

/** 홈택스가 동의를 거절했습니다. 로그인 실패 등입니다. */
export class HometaxConsentRejected extends HttpApiError.Problem<HometaxConsentRejected>()(
  'HometaxConsentRejected',
  { type: problemType('HOMETAX_CONSENT_REJECTED'), status: 422, title: 'Hometax rejected the consent' },
  { code: Schema.tag('HOMETAX_CONSENT_REJECTED'), reason: Schema.String },
) {}

/** 수임동의 저장소입니다. 수임 등록(`REQUESTED`)은 세무대리인 데스크가 만듭니다. */
export class DelegationRepository extends Context.Service<
  DelegationRepository,
  {
    find(
      companyId: Id<'company'>,
      delegationId: Id<'hometaxDelegation'>,
    ): Effect.Effect<Option.Option<DelegationRecord>>
    listByCompany(companyId: Id<'company'>): Effect.Effect<DelegationRecord[]>
    save(delegation: DelegationRecord): Effect.Effect<void>
  }
>()('semu/integrations/DelegationRepository') {
  /** `seed`로 시작해 프로세스 메모리에 수임동의를 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<DelegationRecord> = []) =>
    Layer.effect(
      DelegationRepository,
      Effect.gen(function* () {
        const store = yield* Ref.make(new Map(seed.map((delegation) => [delegation.id, delegation])))
        return DelegationRepository.of({
          find: (companyId, delegationId) =>
            Ref.get(store).pipe(
              Effect.map((all) =>
                Option.filter(Option.fromNullishOr(all.get(delegationId)), (found) => found.companyId === companyId),
              ),
            ),
          listByCompany: (companyId) =>
            Ref.get(store).pipe(
              Effect.map((all) =>
                [...all.values()]
                  .filter((found) => found.companyId === companyId)
                  .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)),
              ),
            ),
          save: (delegation) => Ref.update(store, (all) => new Map(all).set(delegation.id, delegation)),
        })
      }),
    )
}

/** 저장한 수임동의를 응답 형태로 바꿉니다. */
export function delegationView(record: DelegationRecord): HometaxDelegation {
  return {
    id: record.id,
    agencyName: record.agencyName,
    status: record.status,
    requestedAt: record.requestedAt,
    ...(record.agreedAt === undefined ? {} : { agreedAt: record.agreedAt }),
    allowedActions: record.status === 'REQUESTED' ? ['AGREE'] : [],
  }
}
