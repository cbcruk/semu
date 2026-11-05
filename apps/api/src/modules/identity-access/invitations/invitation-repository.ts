import { Context, Effect, Layer, Option } from 'effect'
import { TableFactory } from '../../../shared/persistence/record-table.ts'
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
  /** `iam_invitations` 표에 둡니다. 표가 비어 있으면 `seed`로 시작합니다. */
  static readonly layer = (seed: ReadonlyArray<InvitationRecord> = []) =>
    Layer.effect(
      InvitationRepository,
      Effect.gen(function* () {
        const table = yield* (yield* TableFactory).make<InvitationRecord>('iam_invitations', {
          seed,
          companyOf: (invitation) => invitation.companyId,
        })
        return InvitationRepository.of({
          find: (companyId, id) =>
            Effect.map(
              table.get(id),
              Option.filter((invitation) => invitation.companyId === companyId),
            ),
          findByTokenHash: (tokenHash) =>
            Effect.map(table.all(), (invitations) =>
              Option.fromNullishOr(invitations.find((invitation) => invitation.tokenHash === tokenHash)),
            ),
          listByCompany: (companyId) =>
            Effect.map(table.byCompany(companyId), (invitations) =>
              invitations.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)),
            ),
          save: (invitation) => table.put(invitation),
        })
      }),
    )

  /** `seed`로 시작해 프로세스 메모리에 초대를 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<InvitationRecord> = []) =>
    InvitationRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}
