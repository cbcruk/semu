import { Context, Effect, Layer } from 'effect'
import { monotonicFactory } from 'ulid'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { TableFactory } from '../../../shared/persistence/record-table.ts'

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

/** 저장하는 열람 기록입니다. ID는 밖에 내보내지 않는 행 ID(ULID)라 기록 순서와 같습니다. */
interface PersonalDataAccessRecord extends PersonalDataAccess {
  id: string
}

/** 주민등록번호·계좌번호 원문 열람 기록입니다 (`docs/design/compliance.md`). */
export class PersonalDataAccessLog extends Context.Service<
  PersonalDataAccessLog,
  {
    record(access: PersonalDataAccess): Effect.Effect<void>
    /** 기록한 순서입니다. */
    list(): Effect.Effect<ReadonlyArray<PersonalDataAccess>>
  }
>()('semu/hr/PersonalDataAccessLog') {
  /** `hr_personal_data_accesses` 표에 둡니다. 저장 방식은 {@link TableFactory}가 정합니다. */
  static readonly layer = Layer.effect(
    PersonalDataAccessLog,
    Effect.gen(function* () {
      const table = yield* (yield* TableFactory).make<PersonalDataAccessRecord>('hr_personal_data_accesses', {
        companyOf: (entry) => entry.companyId,
      })
      const nextId = monotonicFactory()
      return PersonalDataAccessLog.of({
        record: (access) => Effect.suspend(() => table.put({ ...access, id: nextId() })),
        list: () => Effect.map(table.all(), (entries) => entries.map(({ id: _, ...access }) => access)),
      })
    }),
  )

  /** 프로세스 메모리에 기록합니다. */
  static readonly layerMemory = PersonalDataAccessLog.layer.pipe(Layer.provide(TableFactory.layerMemory))
}
