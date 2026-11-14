import { Context, Effect, Layer, Option } from 'effect'
import { newId } from '../../../shared/ids/ids.ts'
import type { Id } from '../../../shared/ids/ids.types.ts'
import { TableFactory } from '../../../shared/persistence/record-table.ts'
import { withdrawnEmployeeFilings, withdrawnFilings } from './insurance-filing.aggregate.ts'
import type {
  InsuranceFiling,
  InsuranceFilingKind,
  InsuranceFilingPayloads,
  InsuranceFilingSource,
} from './insurance-filing.types.ts'

/** 새 `PENDING` 신고입니다. 원인이 같은 종류의 이전 신고를 닫는 일은 부르는 쪽이 {@link InsuranceFilingRepository} `withdraw`로 합니다. */
export function pendingFiling<K extends InsuranceFilingKind>(
  target: { companyId: Id<'company'>; employeeId: Id<'employee'> },
  kind: K,
  source: InsuranceFilingSource,
  payload: InsuranceFilingPayloads[K],
  at: string,
): InsuranceFiling {
  return {
    id: newId('insuranceFiling'),
    companyId: target.companyId,
    employeeId: target.employeeId,
    kind,
    source,
    payload,
    status: 'PENDING',
    requestedAt: at,
  } as InsuranceFiling
}

/** 4대보험 신고 저장소입니다. */
export class InsuranceFilingRepository extends Context.Service<
  InsuranceFilingRepository,
  {
    list(companyId: Id<'company'>): Effect.Effect<ReadonlyArray<InsuranceFiling>>
    find(companyId: Id<'company'>, id: Id<'insuranceFiling'>): Effect.Effect<Option.Option<InsuranceFiling>>
    listByEmployee(companyId: Id<'company'>, employeeId: Id<'employee'>): Effect.Effect<ReadonlyArray<InsuranceFiling>>
    save(filing: InsuranceFiling): Effect.Effect<void>
    /** 직원의 열린 신고(`PENDING`·`FAILED`)를 모두 `WITHDRAWN`으로 닫습니다. 직원을 지울 때 씁니다({@link withdrawnEmployeeFilings}). */
    withdrawEmployee(companyId: Id<'company'>, employeeId: Id<'employee'>, at: string): Effect.Effect<void>
    /** 같은 원인·종류의 열린 신고(`PENDING`·`FAILED`)를 `WITHDRAWN`으로 닫습니다({@link withdrawnFilings}). */
    withdraw(
      companyId: Id<'company'>,
      source: InsuranceFilingSource,
      kind: InsuranceFilingKind,
      at: string,
    ): Effect.Effect<void>
  }
>()('semu/hr/InsuranceFilingRepository') {
  /** `hr_insurance_filings` 표에 둡니다. 표가 비어 있으면 `seed`로 시작합니다. 저장 방식은 {@link TableFactory}가 정합니다. */
  static readonly layer = (seed: ReadonlyArray<InsuranceFiling> = []) =>
    Layer.effect(
      InsuranceFilingRepository,
      Effect.gen(function* () {
        const table = yield* (yield* TableFactory).make<InsuranceFiling>('hr_insurance_filings', {
          seed,
          companyOf: (filing) => filing.companyId,
        })
        return InsuranceFilingRepository.of({
          list: (companyId) => table.byCompany(companyId),
          find: (companyId, id) =>
            Effect.map(
              table.get(id),
              Option.filter((filing) => filing.companyId === companyId),
            ),
          listByEmployee: (companyId, employeeId) =>
            Effect.map(table.byCompany(companyId), (filings) => filings.filter((f) => f.employeeId === employeeId)),
          save: (filing) => table.put(filing),
          withdrawEmployee: (companyId, employeeId, at) =>
            Effect.flatMap(table.byCompany(companyId), (filings) =>
              Effect.forEach(withdrawnEmployeeFilings(filings, employeeId, at), table.put, { discard: true }),
            ),
          withdraw: (companyId, source, kind, at) =>
            Effect.flatMap(table.byCompany(companyId), (filings) =>
              Effect.forEach(withdrawnFilings(filings, source, kind, at), table.put, { discard: true }),
            ),
        })
      }),
    )

  /** `seed`로 시작해 프로세스 메모리에 보관합니다. */
  static readonly layerMemory = (seed: ReadonlyArray<InsuranceFiling> = []) =>
    InsuranceFilingRepository.layer(seed).pipe(Layer.provide(TableFactory.layerMemory))
}
