import { Context, Effect, Layer, Ref } from 'effect'
import type { Id } from '../../../shared/ids/ids.types.ts'

/** 개인정보 원문 열람 기록 한 건입니다. */
export interface PersonalDataAccess {
  companyId: Id<'company'>
  userId: Id<'user'>
  /** 열람한 대상입니다. 예: `employee:emp_01J.../registration-number` */
  target: string
  /** `X-Access-Reason`으로 받은 사유입니다. */
  reason: string
  at: string
}

/** 주민등록번호·계좌번호 원문 열람 기록입니다 (`docs/design/compliance.md`). */
export class PersonalDataAccessLog extends Context.Service<
  PersonalDataAccessLog,
  {
    record(access: PersonalDataAccess): Effect.Effect<void>
    list(): Effect.Effect<ReadonlyArray<PersonalDataAccess>>
  }
>()('semu/hr/PersonalDataAccessLog') {
  /** 프로세스 메모리에 기록합니다. */
  static readonly layerMemory = Layer.effect(
    PersonalDataAccessLog,
    Effect.gen(function* () {
      const store = yield* Ref.make<ReadonlyArray<PersonalDataAccess>>([])
      return PersonalDataAccessLog.of({
        record: (access) => Ref.update(store, (entries) => [...entries, access]),
        list: () => Ref.get(store),
      })
    }),
  )
}
