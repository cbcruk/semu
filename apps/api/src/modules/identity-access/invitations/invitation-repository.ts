import { Context, Effect, Layer, Option, Ref } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'
import type { InvitationRecord } from './invitation.ts'

/** 초대 저장소입니다. 링크 토큰은 해시로만 찾습니다. */
export class InvitationRepository extends Context.Service<
  InvitationRepository,
  {
    find(companyId: Id<'company'>, id: Id<'invitation'>): Effect.Effect<Option.Option<InvitationRecord>>
    findByTokenHash(tokenHash: string): Effect.Effect<Option.Option<InvitationRecord>>
    listByCompany(companyId: Id<'company'>): Effect.Effect<InvitationRecord[]>
    save(invitation: InvitationRecord): Effect.Effect<void>
  }
>()('semu/identity-access/InvitationRepository') {
  /** `seed`로 시작해 프로세스 메모리에 초대를 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<InvitationRecord> = []) =>
    Layer.effect(
      InvitationRepository,
      Effect.gen(function* () {
        const store = yield* Ref.make(new Map(seed.map((invitation) => [invitation.id, invitation])))
        const all = Ref.get(store).pipe(Effect.map((invitations) => [...invitations.values()]))
        return InvitationRepository.of({
          find: (companyId, id) =>
            Ref.get(store).pipe(
              Effect.map((invitations) =>
                Option.filter(Option.fromNullishOr(invitations.get(id)), (i) => i.companyId === companyId),
              ),
            ),
          findByTokenHash: (tokenHash) =>
            all.pipe(
              Effect.map((invitations) => Option.fromNullishOr(invitations.find((i) => i.tokenHash === tokenHash))),
            ),
          listByCompany: (companyId) =>
            all.pipe(
              Effect.map((invitations) =>
                invitations
                  .filter((invitation) => invitation.companyId === companyId)
                  .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)),
              ),
            ),
          save: (invitation) => Ref.update(store, (invitations) => new Map(invitations).set(invitation.id, invitation)),
        })
      }),
    )
}
